package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testCapture(t *testing.T) *phoneCapture {
	t.Helper()
	c := newPhoneCapture()
	c.addresses = func() []string { return []string{"192.168.1.20"} }
	// Listen on a free loopback port instead of the real LAN port.
	c.listen = func(network, _ string) (net.Listener, error) { return net.Listen(network, "127.0.0.1:0") }
	t.Cleanup(c.stop)
	return c
}

func desktop(method, path string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:5190"+path, nil)
	r.Header.Set("X-LaserForge-Capture", "1")
	return r
}

func TestDesktopAPIRejectsForeignRequests(t *testing.T) {
	c := testCapture(t)
	noHeader := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:5190/api/phone-capture/start", nil)
	rebind := desktop(http.MethodPost, "/api/phone-capture/start")
	rebind.Host = "evil.example:5190"
	for _, r := range []*http.Request{noHeader, rebind} {
		w := httptest.NewRecorder()
		c.handle(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", w.Code)
		}
	}
}

func TestCaptureRoundTrip(t *testing.T) {
	c := testCapture(t)
	w := httptest.NewRecorder()
	c.handle(w, desktop(http.MethodPost, "/api/phone-capture/start"))
	if w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body)
	}
	var started struct{ URLs []string }
	if err := json.Unmarshal(w.Body.Bytes(), &started); err != nil || len(started.URLs) != 1 {
		t.Fatalf("bad start response %s", w.Body)
	}
	token := c.currentToken()
	if !strings.HasSuffix(started.URLs[0], "192.168.1.20:5191/capture/"+token) {
		t.Fatalf("unexpected url %s", started.URLs[0])
	}

	phone := c.phoneHandler()
	// The camera page needs the token.
	for path, want := range map[string]int{"/capture/" + token: 200, "/capture/wrong": 404, "/": 404} {
		rec := httptest.NewRecorder()
		phone.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want {
			t.Fatalf("GET %s: got %d want %d", path, rec.Code, want)
		}
	}

	// Non-images are refused.
	rec := httptest.NewRecorder()
	phone.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/capture/"+token+"/upload", strings.NewReader("<html>")))
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d", rec.Code)
	}

	jpeg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{1}, 64)...)
	up := httptest.NewRequest(http.MethodPost, "/capture/"+token+"/upload", bytes.NewReader(jpeg))
	up.Header.Set("X-File-Name", "..%2F..%2Fsketch.jpg")
	rec = httptest.NewRecorder()
	phone.ServeHTTP(rec, up)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}

	w = httptest.NewRecorder()
	c.handle(w, desktop(http.MethodPost, "/api/phone-capture/take"))
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), jpeg) {
		t.Fatalf("take: %d", w.Code)
	}
	if got := w.Header().Get("X-Capture-Name"); got != "sketch.jpg" {
		t.Fatalf("name not sanitised: %q", got)
	}
	if w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("bad type %s", w.Header().Get("Content-Type"))
	}
	w = httptest.NewRecorder()
	c.handle(w, desktop(http.MethodPost, "/api/phone-capture/take"))
	if w.Code != http.StatusNoContent {
		t.Fatalf("empty queue: %d", w.Code)
	}

	// Stopping revokes the link.
	w = httptest.NewRecorder()
	c.handle(w, desktop(http.MethodPost, "/api/phone-capture/stop"))
	rec = httptest.NewRecorder()
	phone.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/capture/"+token, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expired link served: %d", rec.Code)
	}
	w = httptest.NewRecorder()
	c.handle(w, desktop(http.MethodPost, "/api/phone-capture/take"))
	if w.Code != http.StatusConflict {
		t.Fatalf("take after stop: %d", w.Code)
	}
}

func TestCleanPhotoName(t *testing.T) {
	cases := map[string]string{
		"art.png":        "art.jpg",
		"photo.jpeg":     "photo.jpeg",
		"a%3Cb%3E.jpg":   "ab.jpg",
		"C:%5Cx%5Cy.jpg": "y.jpg",
	}
	for in, want := range cases {
		if got := cleanPhotoName(in, "image/jpeg"); got != want {
			t.Errorf("cleanPhotoName(%q) = %q, want %q", in, got, want)
		}
	}
	if got := cleanPhotoName("", "image/png"); !strings.HasPrefix(got, "phone-photo-") || !strings.HasSuffix(got, ".png") {
		t.Errorf("default name %q", got)
	}
}
