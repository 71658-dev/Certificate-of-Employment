from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the index.html file directly from the filesystem
        # Since we are in the repo root, we can use the absolute path
        cwd = os.getcwd()
        file_url = f"file://{cwd}/index.html"

        print(f"Navigating to {file_url}")
        page.goto(file_url)

        # Wait for the page to load
        page.wait_for_load_state("networkidle")

        # Check if title is correct
        title = page.title()
        print(f"Page title: {title}")

        # Verify that the external libraries are loaded locally
        # We can check if the script tags point to ./assets/

        # Take a screenshot
        page.screenshot(path="verification/screenshot.png")
        print("Screenshot saved to verification/screenshot.png")

        browser.close()

if __name__ == "__main__":
    run()
