//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// holdProfile locks the profile the way Chromium does on Windows.
func holdProfile(profile string) func() {
	if err := os.MkdirAll(profile, 0o700); err != nil {
		panic(err)
	}
	path, err := syscall.UTF16PtrFromString(filepath.Join(profile, "lockfile"))
	if err != nil {
		panic(err)
	}
	const deleteOnClose = 0x04000000
	handle, err := syscall.CreateFile(path, syscall.GENERIC_WRITE, syscall.FILE_SHARE_READ, nil,
		syscall.CREATE_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL|deleteOnClose, 0)
	if err != nil {
		panic(err)
	}
	return func() { syscall.CloseHandle(handle) }
}

func leaveStaleLock(t *testing.T, profile string) {
	if err := os.WriteFile(filepath.Join(profile, "lockfile"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
}
