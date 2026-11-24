#!/usr/bin/env python3
"""
Apre l'app sul computer per provarla prima di pubblicarla.

  python3 strumenti/prova_locale.py

poi apri http://localhost:8000 nel browser. Ctrl+C per fermare.
(Il server di Python normale non permette di spostarsi avanti e indietro
negli audio: questo sì.)
"""
import http.server
import os
import re
import webbrowser
from pathlib import Path

PORTA = 8000


class Gestore(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        intervallo = self.headers.get('Range')
        percorso = self.translate_path(self.path)
        if not intervallo or not os.path.isfile(percorso):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', intervallo)
        dimensione = os.path.getsize(percorso)
        inizio = int(m.group(1)) if m and m.group(1) else 0
        fine = int(m.group(2)) if m and m.group(2) else dimensione - 1
        fine = min(fine, dimensione - 1)
        if inizio > fine:
            self.send_error(416)
            return None
        f = open(percorso, 'rb')
        f.seek(inizio)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(percorso))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {inizio}-{fine}/{dimensione}')
        self.send_header('Content-Length', str(fine - inizio + 1))
        self.end_headers()
        self._resto = fine - inizio + 1
        return f

    def copyfile(self, sorgente, destinazione):
        resto = getattr(self, '_resto', None)
        if resto is None:
            return super().copyfile(sorgente, destinazione)
        while resto > 0:
            blocco = sorgente.read(min(65536, resto))
            if not blocco:
                break
            destinazione.write(blocco)
            resto -= len(blocco)
        self._resto = None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(Path(__file__).resolve().parent.parent)
    Gestore.extensions_map['.webmanifest'] = 'application/manifest+json'
    Gestore.extensions_map['.lrc'] = 'text/plain; charset=utf-8'
    print(f'App aperta su http://localhost:{PORTA}  (Ctrl+C per fermare)')
    webbrowser.open(f'http://localhost:{PORTA}')
    http.server.ThreadingHTTPServer(('', PORTA), Gestore).serve_forever()
