package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// The relaunched launcher after a native update reuses the window that is already
// open (it reloads itself) instead of opening a second one. An environment variable
// rather than a flag, so that older launchers ignore it.
const afterUpdateEnv = "LASERFORGE_AFTER_UPDATE"

var errNoBrowser = errors.New("no Chrome, Edge or Chromium installation was found")

// appWindow shows Laser Forge in its own window using an installed Chromium-family
// browser in app mode: no tabs, address bar or browser menus, and a dedicated
// profile so the window's lifetime can be tracked and USB/Bluetooth access works.
type appWindow struct {
	browser string // browser executable
	profile string // dedicated --user-data-dir
}

func findAppWindow(override string) (*appWindow, error) {
	browser, err := findBrowser(override)
	if err != nil {
		return nil, err
	}
	profile, err := profileDir(browser)
	if err != nil {
		return nil, err
	}
	return &appWindow{browser: browser, profile: profile}, nil
}

// findBrowser returns the override (a path or command name) or the first installed
// Chromium-family browser, preferring those with Web Serial and Web Bluetooth on.
func findBrowser(override string) (string, error) {
	if override != "" {
		if path := resolveExecutable(override); path != "" {
			return path, nil
		}
		return "", fmt.Errorf("browser not found: %s", override)
	}
	for _, candidate := range browserCandidates() {
		if path := resolveExecutable(candidate); path != "" {
			return path, nil
		}
	}
	return "", errNoBrowser
}

func resolveExecutable(candidate string) string {
	if filepath.IsAbs(candidate) {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
		return ""
	}
	path, err := exec.LookPath(candidate)
	if err != nil {
		return ""
	}
	return path
}

// browserFamily names one profile per browser: a profile written by a newer
// Chrome cannot be opened by an older Edge, so they never share one.
func browserFamily(browser string) string {
	name := strings.TrimSuffix(strings.ToLower(filepath.Base(browser)), ".exe")
	switch {
	case strings.HasPrefix(name, "google-chrome"), name == "chrome" && !strings.Contains(strings.ToLower(browser), "chromium"):
		return "chrome"
	case name == "msedge", strings.HasPrefix(name, "microsoft-edge"):
		return "edge"
	case strings.HasPrefix(name, "chromium"), name == "chrome":
		return "chromium"
	case strings.HasPrefix(name, "brave"):
		return "brave"
	}
	clean := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			return r
		}
		return '-'
	}, name)
	if clean == "" {
		return "browser"
	}
	return clean
}

// args opens the app window. A new profile starts maximized; later launches keep
// the size and position the browser remembers for the window.
func (w *appWindow) args(firstRun bool) []string {
	args := []string{
		"--app=" + appURL,
		"--user-data-dir=" + w.profile,
		"--no-first-run",
		"--no-default-browser-check",
	}
	if firstRun {
		args = append(args, "--start-maximized")
	}
	if runtime.GOOS == "linux" {
		// Group the window under the Laser Forge menu entry (StartupWMClass), and turn on
		// Web Bluetooth, which Chromium keeps behind this flag on Linux. App windows have no
		// address bar, so the flags page the app would otherwise point to is unreachable.
		args = append(args, "--class=LaserForge", "--enable-experimental-web-platform-features")
	}
	return args
}

// start opens a window without waiting for it.
func (w *appWindow) start() (*exec.Cmd, error) {
	_, err := os.Stat(w.profile)
	firstRun := os.IsNotExist(err)
	if err = os.MkdirAll(w.profile, 0o700); err != nil {
		return nil, err
	}
	cmd := exec.Command(w.browser, w.args(firstRun)...)
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

// run opens the app window, or reuses an open one, and returns once it is closed.
func (w *appWindow) run(reuseOpenWindow bool) error {
	if !reuseOpenWindow || !profileInUse(w.profile) {
		started := time.Now()
		cmd, err := w.start()
		if err != nil {
			return err
		}
		waitErr := cmd.Wait()
		if waitErr != nil && time.Since(started) < 10*time.Second && !profileInUse(w.profile) {
			return fmt.Errorf("%s closed immediately: %w", filepath.Base(w.browser), waitErr)
		}
	}
	// If this profile was already open, the browser hands the new window to that process
	// and the one started above exits at once. Serve until the profile itself is closed.
	for profileInUse(w.profile) {
		time.Sleep(time.Second)
	}
	return nil
}

// laserForgeServing reports whether another launcher already serves the app at url.
func laserForgeServing(url string) bool {
	client := http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	page, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	return err == nil && response.StatusCode == http.StatusOK && strings.Contains(string(page), "<title>Laser Forge")
}

// openBrowserTab is the fallback when no app-window browser is available.
func openBrowserTab(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}
