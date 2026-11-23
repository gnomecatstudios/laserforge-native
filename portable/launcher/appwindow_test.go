package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

const fakeBrowserEnv = "LASERFORGE_FAKE_BROWSER"

// The test binary doubles as a fake browser so the window lifecycle can be tested
// without Chrome: it holds the profile lock the way Chromium does.
func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeBrowserEnv); mode != "" {
		fakeBrowser(mode)
		return
	}
	os.Exit(m.Run())
}

func fakeBrowser(mode string) {
	var profile string
	for _, arg := range os.Args[1:] {
		if value, ok := strings.CutPrefix(arg, "--user-data-dir="); ok {
			profile = value
		}
	}
	switch mode {
	case "window": // a browser showing the app window until the user closes it
		release := holdProfile(profile)
		time.Sleep(1500 * time.Millisecond)
		release()
		os.Exit(0)
	case "handoff": // a second launch: pass the window to a running browser and exit
		owner := exec.Command(os.Args[0], "--user-data-dir="+profile)
		owner.Env = append(os.Environ(), fakeBrowserEnv+"=window")
		if owner.Start() != nil {
			os.Exit(2)
		}
		for !profileInUse(profile) {
			time.Sleep(20 * time.Millisecond)
		}
		os.Exit(0)
	default: // a browser that cannot start
		os.Exit(3)
	}
}

func fakeWindow(t *testing.T, mode string) *appWindow {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(fakeBrowserEnv, mode)
	return &appWindow{browser: executable, profile: filepath.Join(t.TempDir(), "profile")}
}

func TestAppWindowRunsUntilClosed(t *testing.T) {
	for _, mode := range []string{"window", "handoff"} {
		t.Run(mode, func(t *testing.T) {
			window := fakeWindow(t, mode)
			started := time.Now()
			if err := window.run(false); err != nil {
				t.Fatal(err)
			}
			if elapsed := time.Since(started); elapsed < 1200*time.Millisecond {
				t.Fatalf("returned after %v, before the window closed", elapsed)
			}
			if profileInUse(window.profile) {
				t.Fatal("profile still in use")
			}
		})
	}
}

func TestAppWindowReportsBrowserFailure(t *testing.T) {
	if err := fakeWindow(t, "crash").run(false); err == nil {
		t.Fatal("expected an error from a browser that exits at once")
	}
}

func TestAppWindowReusesOpenWindowAfterUpdate(t *testing.T) {
	window := &appWindow{browser: filepath.Join(t.TempDir(), "missing-browser"), profile: t.TempDir()}
	release := holdProfile(window.profile)
	go func() {
		time.Sleep(time.Second)
		release()
	}()
	started := time.Now()
	if err := window.run(true); err != nil {
		t.Fatal(err) // starting the missing browser would fail
	}
	if time.Since(started) < 900*time.Millisecond {
		t.Fatal("returned while the window was still open")
	}
}

func TestProfileInUse(t *testing.T) {
	profile := t.TempDir()
	if profileInUse(profile) {
		t.Fatal("empty profile reported in use")
	}
	release := holdProfile(profile)
	if !profileInUse(profile) {
		t.Fatal("held profile reported free")
	}
	release()
	if profileInUse(profile) {
		t.Fatal("released profile reported in use")
	}
	leaveStaleLock(t, profile)
	if profileInUse(profile) {
		t.Fatal("stale lock from a crashed browser reported in use")
	}
}

func TestAppWindowArgs(t *testing.T) {
	window := &appWindow{browser: "chrome", profile: filepath.Join("data", "profile")}
	first, later := window.args(true), window.args(false)
	for _, want := range []string{"--app=" + appURL, "--user-data-dir=" + window.profile, "--no-first-run"} {
		if !slices.Contains(first, want) || !slices.Contains(later, want) {
			t.Fatalf("missing %s", want)
		}
	}
	if !slices.Contains(first, "--start-maximized") || slices.Contains(later, "--start-maximized") {
		t.Fatal("only a new profile should start maximized")
	}
	if linux := runtime.GOOS == "linux"; slices.Contains(first, "--enable-experimental-web-platform-features") != linux ||
		slices.Contains(first, "--class=LaserForge") != linux {
		t.Fatal("Linux window class and Web Bluetooth flags are Linux-only")
	}
}

func TestBrowserFamily(t *testing.T) {
	for browser, want := range map[string]string{
		"C:/Program Files/Google/Chrome/Application/chrome.exe":        "chrome",
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe": "edge",
		"C:/Users/me/AppData/Local/Chromium/Application/chrome.exe":    "chromium",
		"/usr/bin/google-chrome-stable":                                "chrome",
		"/usr/bin/chromium-browser":                                    "chromium",
		"/snap/bin/chromium":                                           "chromium",
		"/usr/bin/microsoft-edge-stable":                               "edge",
		"/usr/bin/brave-browser":                                       "brave",
		"/opt/vivaldi/Vivaldi Stable":                                  "vivaldi-stable",
	} {
		if got := browserFamily(browser); got != want {
			t.Errorf("%s: got %s, want %s", browser, got, want)
		}
	}
}

func TestFindBrowserOverride(t *testing.T) {
	browser := filepath.Join(t.TempDir(), "my-chromium")
	if err := os.WriteFile(browser, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if found, err := findBrowser(browser); err != nil || found != browser {
		t.Fatalf("got %q, %v", found, err)
	}
	if _, err := findBrowser(browser + "-missing"); err == nil {
		t.Fatal("accepted a missing browser")
	}
}

func TestLaserForgeServing(t *testing.T) {
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<!doctype html><title>Laser Forge</title>"))
	}))
	defer app.Close()
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<!doctype html><title>Something else</title>"))
	}))
	defer other.Close()
	if !laserForgeServing(app.URL) || laserForgeServing(other.URL) {
		t.Fatal("misidentified the server on the Laser Forge port")
	}
	other.Close()
	if laserForgeServing(other.URL) {
		t.Fatal("a closed port is not Laser Forge")
	}
}
