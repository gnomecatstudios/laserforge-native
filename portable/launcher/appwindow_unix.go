//go:build !windows

package main

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func browserCandidates() []string {
	// Raspberry Pi OS ships Chromium; Google Chrome has no ARM Linux build.
	return []string{
		"google-chrome-stable", "google-chrome", "chromium", "chromium-browser",
		"microsoft-edge-stable", "microsoft-edge", "brave-browser",
	}
}

func profileDir(browser string) (string, error) {
	// Snap-confined browsers may only write inside their own snap folder.
	if snap := snapName(browser); snap != "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "snap", snap, "common", "laserforge-app-window"), nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "laserforge", "app-window", browserFamily(browser)), nil
}

func snapName(browser string) string {
	if strings.HasPrefix(browser, "/snap/bin/") {
		return filepath.Base(browser)
	}
	// Ubuntu's /usr/bin/chromium-browser is a small script that starts the Chromium snap.
	file, err := os.Open(browser)
	if err != nil {
		return ""
	}
	defer file.Close()
	head := make([]byte, 4096)
	n, _ := io.ReadFull(file, head)
	script := string(head[:n])
	if strings.HasPrefix(script, "#!") && strings.Contains(script, "/snap/bin/chromium") {
		return "chromium"
	}
	return ""
}

// profileInUse reports whether a browser has the profile open. Chromium links
// <profile>/SingletonLock to "hostname-pid" while running and removes it on exit.
func profileInUse(profile string) bool {
	target, err := os.Readlink(filepath.Join(profile, "SingletonLock"))
	if err != nil {
		return false
	}
	dash := strings.LastIndexByte(target, '-')
	if dash < 0 {
		return false
	}
	pid, err := strconv.Atoi(target[dash+1:])
	if err != nil || pid <= 0 {
		return false
	}
	err = syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// attachConsole is only needed on Windows; Linux launchers inherit their terminal.
func attachConsole() {}

// showError reaches users who started Laser Forge from a menu or desktop shortcut,
// where nothing shows the launcher's stderr.
func showError(message string) {
	if info, err := os.Stderr.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		return
	}
	for _, dialog := range [][]string{
		{"zenity", "--error", "--no-markup", "--title=Laser Forge", "--text=" + message},
		{"kdialog", "--title", "Laser Forge", "--error", message},
		{"notify-send", "Laser Forge", message},
	} {
		if path, err := exec.LookPath(dialog[0]); err == nil {
			_ = exec.Command(path, dialog[1:]...).Run()
			return
		}
	}
}
