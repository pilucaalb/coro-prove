#!/usr/bin/env python3
"""
Prepara i brani per l'app «Prove del coro».

Per ogni cartella dentro brani/ :
  - riconosce voce (soprano, contralto, tenore, basso) e versione (suonata, cantata)
    dal nome del file audio;
  - converte gli audio in MP3 leggeri (serve ffmpeg) così suonano su tutti i telefoni,
    iPhone compresi; gli originali vengono spostati in _originali/;
  - legge il titolo da testo.lrc (riga [ti:...]) o, se manca, dal nome della cartella;
  - riscrive brani/catalogo.json, che è l'elenco usato dall'app.

Uso:
  python3 strumenti/genera_catalogo.py              # prepara tutto
  python3 strumenti/genera_catalogo.py --in-ordine  # i file di WhatsApp senza nome vengono assegnati
                                                    # nell'ordine in cui la maestra li manda:
                                                    # soprani (musica, voce), contralti, tenori, bassi
  python3 strumenti/genera_catalogo.py --rinomina   # fa ascoltare i file senza nome e chiede di che parte sono
"""

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
BRANI = RADICE / 'brani'
SW = RADICE / 'sw.js'

ESTENSIONI_AUDIO = {'.mp3', '.m4a', '.aac', '.opus', '.ogg', '.oga', '.wav', '.flac', '.mp4', '.3gp', '.amr', '.wma'}
ESTENSIONI_SPARTITO = {'.pdf', '.jpg', '.jpeg', '.png'}
BITRATE = '64k'   # mono 64 kbit/s: circa 0,5 MB al minuto, più che sufficiente per provare

VOCI = {
    'soprano': ('soprano', 'soprani', 'sop', 's'),
    'contralto': ('contralto', 'contralti', 'alto', 'alti', 'contr'),
    'tenore': ('tenore', 'tenori', 'tenor', 'ten', 't'),
    'basso': ('basso', 'bassi', 'bass', 'bas', 'b'),
}
VERSIONI = {
    'suonata': ('suonata', 'suonato', 'base', 'musica', 'strumentale', 'piano', 'solomusica', 'm'),
    'cantata': ('cantata', 'cantato', 'voce', 'guida', 'canto', 'conguida', 'v'),
}


def parole(nome):
    return [p for p in re.split(r'[^a-z0-9]+', nome.lower()) if p]


def riconosci(stem):
    """Restituisce (voce, versione) dal nome del file, oppure (None, None)."""
    ps = parole(stem)
    voce = next((v for v, sin in VOCI.items() for p in ps if p in sin), None)
    versione = next((v for v, sin in VERSIONI.items() for p in ps if p in sin), None)
    return voce, versione


def bel_titolo(nome_cartella):
    t = re.sub(r'[-_]+', ' ', nome_cartella).strip()
    return t[:1].upper() + t[1:]


def titolo_da_lrc(percorso):
    try:
        for riga in percorso.read_text(encoding='utf-8').splitlines():
            m = re.match(r'^\s*\[ti:(.*)\]\s*$', riga, re.I)
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return None


def ffmpeg_disponibile():
    return shutil.which('ffmpeg') is not None


def converti(origine, destinazione):
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(origine),
           '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', BITRATE, str(destinazione)]
    subprocess.run(cmd, check=True)


def lettore():
    for prog, args in (('mpv', ['--no-video', '--really-quiet']), ('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet'])):
        if shutil.which(prog):
            return [prog, *args]
    return None


def chiedi(domanda, scelte):
    while True:
        r = input(domanda).strip().lower()
        if r in scelte:
            return scelte[r]
        print('   Risposta non valida, riprova.')


def rinomina_interattiva(cartella):
    """Fa ascoltare i file senza un nome riconoscibile e chiede di che parte si tratta."""
    da_fare = [f for f in sorted(cartella.iterdir())
               if f.is_file() and f.suffix.lower() in ESTENSIONI_AUDIO and None in riconosci(f.stem)]
    if not da_fare:
        return
    play = lettore()
    print(f'\n== {cartella.name}: {len(da_fare)} file da riconoscere ==')
    if not play:
        print('   (installa mpv per ascoltarli da qui: sudo pacman -S mpv)')
    for f in da_fare:
        print(f'\n   {f.name}')
        proc = subprocess.Popen([*play, str(f)], stdin=subprocess.DEVNULL) if play else None
        try:
            voce = chiedi('   Voce?  s=soprano  c=contralto  t=tenore  b=basso  x=salta : ',
                          {'s': 'soprano', 'c': 'contralto', 't': 'tenore', 'b': 'basso', 'x': None})
            versione = None
            if voce:
                versione = chiedi('   Versione?  m=solo musica  v=con voce guida : ',
                                  {'m': 'suonata', 'v': 'cantata'})
        finally:
            if proc:
                proc.terminate()
        if voce and versione:
            nuovo = f.with_name(f'{voce}-{versione}{f.suffix.lower()}')
            if nuovo.exists():
                print(f'   Attenzione: {nuovo.name} esiste già, lascio {f.name} com\'è.')
            else:
                f.rename(nuovo)
                print(f'   → {nuovo.name}')


ORDINE_MAESTRA = [(v, s) for v in ('soprano', 'contralto', 'tenore', 'basso') for s in ('suonata', 'cantata')]


def chiave_cronologica(f):
    """Ordina i file di WhatsApp nell'ordine in cui sono arrivati.
    «WhatsApp Audio 2026-11-20 at 18.03.12 (1).opus» viene dopo quello senza (1)."""
    m = re.match(r'^(.*?)(?: \((\d+)\))?$', f.stem)
    return (m.group(1), int(m.group(2) or 0), f.name)


def rinomina_in_ordine(cartella):
    """La maestra manda le parti sempre in quest'ordine: soprani (musica, voce), contralti,
    tenori, bassi. Assegna le parti ai file senza nome in base all'ordine di arrivo."""
    da_fare = sorted((f for f in cartella.iterdir()
                      if f.is_file() and f.suffix.lower() in ESTENSIONI_AUDIO and None in riconosci(f.stem)),
                     key=chiave_cronologica)
    if not da_fare:
        return
    print(f'\n== {cartella.name}: {len(da_fare)} file senza nome ==')
    if len(da_fare) != len(ORDINE_MAESTRA):
        print(f'   Mi aspettavo 8 file, ne trovo {len(da_fare)}: usa --rinomina e assegnali uno per uno.')
        return
    nomi = {'suonata': 'solo musica', 'cantata': 'con voce guida'}
    for f, (voce, versione) in zip(da_fare, ORDINE_MAESTRA):
        print(f'   {f.name:45} → {voce} {nomi[versione]}')
    if input('   Va bene così? [s/n] ').strip().lower() != 's':
        print('   Non rinomino niente. Puoi usare --rinomina per ascoltarli uno per uno.')
        return
    for f, (voce, versione) in zip(da_fare, ORDINE_MAESTRA):
        nuovo = f.with_name(f'{voce}-{versione}{f.suffix.lower()}')
        if nuovo.exists():
            print(f'   Attenzione: {nuovo.name} esiste già, lascio {f.name} com\'è.')
        else:
            f.rename(nuovo)


def prepara_brano(cartella, avvisi):
    parti = {}
    originali = cartella / '_originali'
    for f in sorted(cartella.iterdir()):
        if not f.is_file() or f.suffix.lower() not in ESTENSIONI_AUDIO:
            continue
        voce, versione = riconosci(f.stem)
        if not voce or not versione:
            avvisi.append(f'{cartella.name}/{f.name}: non capisco voce o versione dal nome '
                          '(rinominalo, es. «tenore-cantata.opus», o usa --rinomina)')
            continue
        finale = cartella / f'{voce}-{versione}.mp3'
        if finale.exists() and finale != f:
            avvisi.append(f'{cartella.name}/{f.name}: c\'è già {finale.name}, lo ignoro')
            continue
        if f.suffix.lower() != '.mp3' or f.name != finale.name:
            if f.suffix.lower() == '.mp3':
                f.rename(finale)
            elif ffmpeg_disponibile():
                print(f'   converto {f.name} → {finale.name}')
                converti(f, finale)
                originali.mkdir(exist_ok=True)
                f.rename(originali / f.name)
            else:
                avvisi.append(f'{cartella.name}/{f.name}: serve ffmpeg per convertirlo in MP3')
                finale = f
        if voce in parti and versione in parti[voce] and parti[voce][versione] != finale.name:
            avvisi.append(f'{cartella.name}: due file per {voce} {versione}, uso {finale.name}')
        parti.setdefault(voce, {})[versione] = finale.name

    testo = next((n for n in ('testo.lrc', 'testo.txt') if (cartella / n).exists()), None)
    if not testo:
        avvisi.append(f'{cartella.name}: manca testo.lrc (il brano si vedrà senza testo)')
    spartito = next((f.name for f in sorted(cartella.iterdir())
                     if f.is_file() and f.suffix.lower() in ESTENSIONI_SPARTITO), None)
    titolo = (titolo_da_lrc(cartella / testo) if testo else None) or bel_titolo(cartella.name)
    if not parti:
        avvisi.append(f'{cartella.name}: nessun audio riconosciuto, il brano non compare nell\'app')
        return None
    ordine = ['soprano', 'contralto', 'tenore', 'basso']
    tempi = 'tempi.json' if (cartella / 'tempi.json').exists() else None
    if tempi:
        try:
            dati = json.loads((cartella / tempi).read_text(encoding='utf-8'))
            for voce, versioni in parti.items():
                for f in versioni.values():
                    if f not in dati:
                        avvisi.append(f'{cartella.name}: tempi.json non ha i tempi di {f}')
        except (OSError, ValueError) as e:
            avvisi.append(f'{cartella.name}: tempi.json non è leggibile ({e})')
            tempi = None
    return {
        'id': cartella.name,
        'titolo': titolo,
        'cartella': f'brani/{cartella.name}',
        'testo': testo,
        'tempi': tempi,
        'spartito': spartito,
        'parti': {v: parti[v] for v in ordine if v in parti},
    }


def aggiorna_versione_sw():
    if not SW.exists():
        return
    nuova = dt.datetime.now().strftime('%Y-%m-%d-%H%M')
    testo = SW.read_text(encoding='utf-8')
    testo = re.sub(r"const VERSIONE = '[^']*';", f"const VERSIONE = '{nuova}';", testo, count=1)
    SW.write_text(testo, encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rinomina', action='store_true', help='fa ascoltare i file senza nome e chiede di che parte sono')
    ap.add_argument('--in-ordine', action='store_true',
                    help='assegna le parti in base all\'ordine di arrivo: S musica, S voce, C musica, C voce, T…, B…')
    args = ap.parse_args()

    if not BRANI.is_dir():
        sys.exit(f'Non trovo la cartella {BRANI}')
    cartelle = sorted(d for d in BRANI.iterdir() if d.is_dir() and not d.name.startswith(('.', '_')))

    if args.in_ordine:
        for c in cartelle:
            rinomina_in_ordine(c)
    if args.rinomina:
        for c in cartelle:
            rinomina_interattiva(c)

    avvisi, brani = [], []
    for c in cartelle:
        b = prepara_brano(c, avvisi)
        if b:
            brani.append(b)
    brani.sort(key=lambda b: b['titolo'].lower())

    catalogo = {'aggiornato': dt.date.today().strftime('%d/%m/%Y'), 'brani': brani}
    (BRANI / 'catalogo.json').write_text(json.dumps(catalogo, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    aggiorna_versione_sw()

    print(f'\nCatalogo aggiornato: {len(brani)} brani.')
    for b in brani:
        voci = ', '.join(f"{v} ({' + '.join({'suonata': 'musica', 'cantata': 'voce'}[x] for x in vv)})" for v, vv in b['parti'].items())
        print(f"  • {b['titolo']}: {voci}")
    if avvisi:
        print('\nDa controllare:')
        for a in avvisi:
            print('  ! ' + a)


if __name__ == '__main__':
    main()
