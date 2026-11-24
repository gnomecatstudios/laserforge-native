package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStableVersions(t *testing.T) {
	for _, value := range []string{"", "1.2", "1.2.3-beta", "v1.2.3", "1.2.3/evil"} {
		if _, err := stableVersion(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	if !newer("0.10.0", "0.9.9") || newer("1.0.0", "1.0.0") || newer("0.9.9", "0.10.0") {
		t.Fatal("incorrect version order")
	}
}
func updateArchive(t *testing.T, extra map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	metadata, _ := json.Marshal(installation{nativePlatform(), "1.2.3"})
	binaryName := "LaserForge-Portable"
	header := make([]byte, 128)
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
		copy(header, "MZ")
		binary.LittleEndian.PutUint32(header[60:], 64)
		copy(header[64:], "PE\x00\x00")
		binary.LittleEndian.PutUint16(header[68:], 0x8664)
	} else {
		copy(header, "\x7fELF")
		header[5] = 1
		switch runtime.GOARCH {
		case "amd64":
			header[4] = 2
			binary.LittleEndian.PutUint16(header[18:], 62)
		case "arm64":
			header[4] = 2
			binary.LittleEndian.PutUint16(header[18:], 183)
		case "arm":
			header[4] = 1
			binary.LittleEndian.PutUint16(header[18:], 40)
		}
	}
	entries := map[string]string{"LaserForge-Portable/release.json": string(metadata), "LaserForge-Portable/" + binaryName: string(header), "LaserForge-Portable/Fonts/test.ttf": "font"}
	for name, value := range extra {
		entries[name] = value
	}
	for name, value := range entries {
		stream, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		stream.Write([]byte(value))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func TestArchiveValidation(t *testing.T) {
	expected := installation{nativePlatform(), "1.2.3"}
	if err := extractUpdate(updateArchive(t, nil), t.TempDir(), expected); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"LaserForge-Portable/../escape", "LaserForge-Portable/evil.exe", "LaserForge-Portable/Fonts/../../escape", "LaserForge-Portable/Fonts/a:b", "Other/release.json", "LaserForge-Portable/README.txt/evil", "LaserForge-Portable/Fonts\\escape"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			if err := extractUpdate(updateArchive(t, map[string]string{name: "evil"}), root, expected); err == nil {
				t.Fatal("unsafe archive accepted")
			}
			entries, _ := os.ReadDir(root)
			if len(entries) != 0 {
				t.Fatal("wrote files before validating archive")
			}
		})
	}
	if err := extractUpdate(updateArchive(t, nil), t.TempDir(), installation{nativePlatform(), "9.9.9"}); err == nil {
		t.Fatal("wrong version accepted")
	}
	binaryName := "LaserForge-Portable"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	if err := extractUpdate(updateArchive(t, map[string]string{"LaserForge-Portable/" + binaryName: "wrong"}), t.TempDir(), expected); err == nil {
		t.Fatal("invalid executable accepted")
	}
}
func TestUpdateRequestAuthorization(t *testing.T) {
	u := &updateState{Status: "idle", Token: "secret", root: t.TempDir()}
	for _, test := range []struct {
		method, host, origin, token string
		status                      int
	}{
		{"POST", "127.0.0.1:5190", "https://evil.example", "secret", 403},
		{"POST", "127.0.0.1:5190", "http://127.0.0.1:5190", "wrong", 403},
		{"POST", "evil.example", "http://127.0.0.1:5190", "secret", 403},
		{"GET", "evil.example", "", "", 403},
		{"GET", "127.0.0.1:5190", "", "", 200},
		{"DELETE", "127.0.0.1:5190", "", "", 405},
		{"POST", "127.0.0.1:5190", "http://127.0.0.1:5190", "secret", 409},
	} {
		req := httptest.NewRequest(test.method, "http://"+test.host+"/api/portable-update?action=install", nil)
		req.Header.Set("Origin", test.origin)
		req.Header.Set("X-LaserForge-Update", test.token)
		response := httptest.NewRecorder()
		u.handle(response, req)
		if response.Code != test.status {
			t.Fatalf("%+v got %d", test, response.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(u.root, ".native-update.zip")); !os.IsNotExist(err) {
		t.Fatal("unauthorized request changed installation")
	}
}

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// fakeReleases serves GitHub's public release pages; the REST API must never be used.
func fakeReleases(t *testing.T, latest func() (int, string), files func(name string) []byte) {
	t.Helper()
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = fakeTransport(func(r *http.Request) (*http.Response, error) {
		header := make(http.Header)
		status, body := 200, []byte{}
		switch {
		case r.URL.Host != "github.com":
			t.Errorf("unexpected request to %s", r.URL)
			status = 403
		case r.URL.String() == releaseBase+"/latest":
			var location string
			status, location = latest()
			if location != "" {
				header.Set("Location", location)
			}
		default:
			prefix := releaseBase + "/download/v1.2.3/"
			name, found := strings.CutPrefix(r.URL.String(), prefix)
			if !found {
				status = 404
			} else if body = files(name); body == nil {
				status = 404
			}
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(body)), Header: header, Request: r}, nil
	})
}
func TestReleaseChecksumVerification(t *testing.T) {
	payload := updateArchive(t, nil)
	name := packageName(nativePlatform(), "1.2.3")
	digest := sha256.Sum256(payload)
	corrupted := false
	fakeReleases(t, func() (int, string) { return 302, releaseBase + "/tag/v1.2.3" }, func(file string) []byte {
		switch file {
		case "SHA256SUMS.txt":
			return []byte(fmt.Sprintf("%x  %s\n", digest, name))
		case name:
			body := append([]byte{}, payload...)
			if corrupted {
				body[0] ^= 1
			}
			return body
		}
		return nil
	})
	current := installation{nativePlatform(), "1.0.0"}
	if data, version, err := verifiedDownload(current); err != nil || version != "1.2.3" || !bytes.Equal(data, payload) {
		t.Fatalf("valid download rejected: %v", err)
	}
	corrupted = true
	if _, _, err := verifiedDownload(current); err == nil {
		t.Fatal("corrupt download accepted")
	}
	tampered := append([]byte{}, payload...)
	tampered[0] ^= 1
	if _, _, err := verifiedDownload(current, tampered); err == nil {
		t.Fatal("tampered cache accepted")
	}
	if data, _, err := verifiedDownload(installation{nativePlatform(), "1.2.3"}); err != nil || data != nil {
		t.Fatal("current installation offered update")
	}
}
func TestPackageNames(t *testing.T) {
	for platform, want := range map[string]string{
		"windows-x64":        "LaserForge-Portable-windows-x64-v3.0.2.zip",
		"linux-x64":          "LaserForge-Portable-linux-x64-v3.0.2.zip",
		"raspberry-pi-arm64": "LaserForge-Portable-RPi-ARM64-v3.0.2.zip",
		"raspberry-pi-arm32": "LaserForge-Portable-RPi-ARM32-v3.0.2.zip",
	} {
		if got := packageName(platform, "3.0.2"); got != want {
			t.Fatalf("%s: got %s", platform, got)
		}
	}
}
func TestLatestReleaseRedirect(t *testing.T) {
	var status int
	var location string
	fakeReleases(t, func() (int, string) { return status, location }, func(string) []byte { return nil })
	for _, test := range []struct {
		status   int
		location string
		want     string
	}{
		{302, releaseBase + "/tag/v1.2.3", "1.2.3"},
		{302, "/" + releaseRepo + "/releases/tag/v1.2.3", "1.2.3"},
		{302, releaseBase, ""},
		{302, releaseBase + "/tag/v1.2.3-beta", ""},
		{302, releaseBase + "/tag/1.2.3", ""},
		{302, releaseBase + "/tag/v1.2.3/evil", ""},
		{302, "https://github.com/someone/else/releases/tag/v9.9.9", ""},
		{302, "https://evil.example/" + releaseRepo + "/releases/tag/v9.9.9", ""},
		{302, "", ""},
		{200, "", ""},
		{403, "", ""},
	} {
		status, location = test.status, test.location
		version, err := latestVersion()
		if version != test.want || (test.want == "") != (err != nil) {
			t.Fatalf("%+v: got %q, %v", test, version, err)
		}
	}
	status, location = 403, ""
	if _, err := latestVersion(); err == nil || !strings.Contains(err.Error(), "try again later") {
		t.Fatalf("rate limit not explained: %v", err)
	}
}
func TestUpdateCheckAction(t *testing.T) {
	fakeReleases(t, func() (int, string) { return 302, releaseBase + "/tag/v1.2.3" }, func(string) []byte { return nil })
	u := &updateState{Status: "idle", Token: "secret", root: t.TempDir()}
	check := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "http://127.0.0.1:5190/api/portable-update?action=check", nil)
		req.Header.Set("Origin", "http://127.0.0.1:5190")
		req.Header.Set("X-LaserForge-Update", token)
		response := httptest.NewRecorder()
		u.handle(response, req)
		return response
	}
	if response := check("wrong"); response.Code != 403 {
		t.Fatalf("unauthorized check got %d", response.Code)
	}
	response := check("secret")
	var result map[string]string
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result["version"] != "1.2.3" {
		t.Fatalf("check got %d %s", response.Code, response.Body)
	}
	if u.Status != "idle" {
		t.Fatal("check changed the update state")
	}
}
