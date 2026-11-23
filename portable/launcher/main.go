package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"time"
)

// Include underscore-prefixed Vite chunks as well as ordinary app assets.
//
//go:embed all:dist
var assets embed.FS

const address = "127.0.0.1:5190"
const appURL = "http://127.0.0.1:5190/"

func main() {
	serverOnly := flag.Bool("no-browser", false, "serve the app without opening a window")
	browserTab := flag.Bool("browser-tab", false, "open the app in the default browser instead of its own window")
	browser := flag.String("browser", os.Getenv("LASERFORGE_BROWSER"), "Chrome, Edge or Chromium executable for the app window")
	installRoot := flag.String("install-update", "", "internal portable update helper")
	flag.Parse()
	if *installRoot != "" {
		if err := applyNativeUpdate(*installRoot); err != nil {
			fail(err)
		}
		return
	}
	afterUpdate := os.Getenv(afterUpdateEnv) != ""
	os.Unsetenv(afterUpdateEnv)
	if *serverOnly || *browserTab {
		attachConsole()
	}
	files, err := fs.Sub(assets, "dist")
	if err != nil {
		fail(err)
	}
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		// Launching again while Laser Forge runs opens another window instead of failing.
		if !*serverOnly && laserForgeServing(appURL) && openAnotherWindow(*browser, *browserTab) == nil {
			return
		}
		fail(fmt.Errorf("cannot start on %s: %w; close any other Laser Forge launcher and try again", address, err))
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(files)))
	if updater := portableUpdates(files); updater != nil {
		mux.HandleFunc("/api/portable-update", updater.handle)
	}
	mux.HandleFunc("/api/phone-capture/", newPhoneCapture().handle)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { fail(server.Serve(listener)) }()

	if *serverOnly || *browserTab {
		printServerBanner()
		if *browserTab {
			if err := openBrowserTab(appURL); err != nil {
				fmt.Println("Open the address above manually:", err)
			}
		}
		select {}
	}
	window, err := findAppWindow(*browser)
	if err == nil {
		if err = window.run(afterUpdate); err == nil {
			return // the app window was closed
		}
	}
	// Without a usable app-window browser, serve a browser tab until stopped.
	attachConsole()
	printServerBanner()
	if tabErr := openBrowserTab(appURL); tabErr != nil {
		fmt.Println("Open the address above manually:", tabErr)
	}
	showError(fmt.Sprintf("Laser Forge could not open its app window: %v.\n\n"+
		"It opened in your default browser instead. Install Chrome, Edge or Chromium for USB and Bluetooth lasers.", err))
	select {}
}

func openAnotherWindow(browser string, tab bool) error {
	if !tab {
		if window, err := findAppWindow(browser); err == nil {
			if _, err = window.start(); err == nil {
				return nil
			}
		}
	}
	return openBrowserTab(appURL)
}

func printServerBanner() {
	fmt.Println("LaserForge Portable — offline local server")
	fmt.Println("Open", appURL, "in Chrome or Edge for USB machine control.")
	fmt.Println("Keep this window open. Press Ctrl+C to stop.")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	showError(err.Error())
	os.Exit(1)
}
