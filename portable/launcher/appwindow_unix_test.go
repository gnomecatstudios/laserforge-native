//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// holdProfile locks the profile the way Chromium does on Linux.
func holdProfile(profile string) func() {
	if err := os.MkdirAll(profile, 0o700); err != nil {
		panic(err)
	}
	lock := filepath.Join(profile, "SingletonLock")
	host, _ := os.Hostname()
	if err := os.Symlink(fmt.Sprintf("%s-%d", host, os.Getpid()), lock); err != nil {
		panic(err)
	}
	return func() { os.Remove(lock) }
}

func leaveStaleLock(t *testing.T, profile string) {
	// Above the kernel's largest possible PID, so no process can own it.
	if err := os.Symlink("host-999999999", filepath.Join(profile, "SingletonLock")); err != nil {
		t.Fatal(err)
	}
}
