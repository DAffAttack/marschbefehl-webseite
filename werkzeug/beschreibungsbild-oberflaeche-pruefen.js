// Klickt das Feld „Bild in der Beschreibung“ in der lokalen Verwaltung durch. Nur lokal (netlify dev):
//   node werkzeug/beschreibungsbild-oberflaeche-pruefen.js <Führungs-ID> <Pfad zu einem JPG> <Pfad für das Prüfbild>
// Braucht Python mit Playwright und Chrome.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { spawnSync } = require('child_process');
const [id, bild, aus] = process.argv.slice(2);
const r = spawnSync('python', ['-X', 'utf8', '-c', `
import os, sys
from playwright.sync_api import sync_playwright
fid, bild, aus = sys.argv[1:4]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    s = b.new_context(viewport={"width": 1280, "height": 1000}).new_page()
    s.goto("http://localhost:8888/fuehrungen-verwaltung.html")
    s.fill('input[type=password]', os.environ['FUEHRUNGEN_ADMIN_PASSWORD'])
    s.keyboard.press('Enter')
    s.wait_for_selector('#nf-bild-beschreibung-input', state='attached', timeout=20000)
    s.wait_for_selector('.btn-toggle-fuehrung-edit', timeout=20000)
    print('Feld „Neue Führung“ vorhanden:', s.locator('#nf-bild-beschreibung-input').count() == 1)
    kart = s.locator('.ef-bild-beschreibung-input')
    print('Bearbeiten-Felder:', kart.count())
    w = s.locator('xpath=//input[contains(@class,"ef-titel") and contains(@value,"Ohne Beschreibungsbild")]/ancestor::*[contains(@class,"fuehrung-edit-form")]').last
    w.evaluate("e => e.classList.add('is-visible')")
    print('Haken „entfernen“ sichtbar:', w.locator('.ef-bild-beschreibung-weg').count() == 1)
    w.locator('.ef-bild-beschreibung-input').set_input_files(bild)
    st = w.locator('.ef-bild-beschreibung-input').locator('xpath=..').locator('.upload-status')
    s.wait_for_timeout(3000)
    print('Status:', st.inner_text())
    w.locator('.ef-save').click()
    s.wait_for_timeout(1500)
    s.screenshot(path=aus, full_page=False)
    b.close()
`, id, bild, aus], { encoding: 'utf8', env: process.env });
console.log(r.stdout); if (r.status !== 0) { console.error((r.stderr || '').replace(process.env.FUEHRUNGEN_ADMIN_PASSWORD, '***').slice(-1500)); process.exit(1); }
