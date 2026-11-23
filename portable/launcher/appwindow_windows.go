//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = kernel32.NewProc("AttachConsole")
	procAllocConsole  = kernel32.NewProc("AllocConsole")
	user32            = syscall.NewLazyDLL("user32.dll")
	procMessageBox    = user32.NewProc("MessageBoxW")
)

func browserCandidates() []string {
	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	localAppData := os.Getenv("LocalAppData")
	var list []string
	add := func(relative string, bases ...string) {
		for _, base := range bases {
			if base != "" {
				list = append(list, filepath.Join(base, relative))
			}
		}
	}
	add(`Google\Chrome\Application\chrome.exe`, programFiles, programFilesX86, localAppData)
	// Edge ships with Windows 10 and 11, so the app window opens on every supported PC.
	add(`Microsoft\Edge\Application\msedge.exe`, programFilesX86, programFiles)
	add(`Chromium\Application\chrome.exe`, localAppData)
	add(`BraveSoftware\Brave-Browser\Application\brave.exe`, programFiles, localAppData)
	return list
}

func profileDir(browser string) (string, error) {
	base, err := os.UserCacheDir() // %LocalAppData%: never synced to other PCs
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "LaserForge", "AppWindow", browserFamily(browser)), nil
}

// profileInUse reports whether a browser has the profile open. Chromium holds
// <profile>\lockfile open without delete sharing while running and deletes it on exit.
func profileInUse(profile string) bool {
	lock := filepath.Join(profile, "lockfile")
	if _, err := os.Lstat(lock); err != nil {
		return false
	}
	return os.Remove(lock) != nil
}

// attachConsole gives the GUI-subsystem launcher a console for server-only and
// browser-tab modes: the terminal it was started from, or a new console window.
func attachConsole() {
	const attachParentProcess = uintptr(^uint32(0))
	if redirected(syscall.Stdout) {
		return
	}
	if attached, _, _ := procAttachConsole.Call(attachParentProcess); attached == 0 {
		if allocated, _, _ := procAllocConsole.Call(); allocated == 0 {
			return
		}
	}
	if output, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = output, output
	}
	if input, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = input
	}
}

func redirected(handle syscall.Handle) bool {
	if handle == 0 || handle == syscall.InvalidHandle {
		return false
	}
	kind, err := syscall.GetFileType(handle)
	return err == nil && (kind == syscall.FILE_TYPE_DISK || kind == syscall.FILE_TYPE_PIPE)
}

func showError(message string) {
	text, err := syscall.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	title, _ := syscall.UTF16PtrFromString("Laser Forge")
	const iconError = 0x10
	procMessageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), iconError)
}
