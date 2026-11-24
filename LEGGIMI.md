# Prove del coro

App web per le prove del coro circuitale. Ogni corista sceglie la sua voce
(Soprani, Contralti, Tenori, Bassi), apre il brano e ascolta la sua parte,
**solo musica** o **con voce guida**, mentre il testo scorre e si illumina riga per riga.

Funziona su qualsiasi telefono (Android e iPhone) aprendo un link: non serve
nessuno store. Si può aggiungere alla schermata Home come un'app vera.

## Cosa sa fare

- Ricorda la voce del corista: la sceglie una volta sola.
- Passa da «Solo musica» a «Con voce guida» **senza perdere il punto**.
- Si può anche ascoltare la parte di un'altra voce dallo stesso punto.
- Tocca una riga del testo per ripartire da lì.
- Rallenta a 85% o 70% senza cambiare l'intonazione.
- «Ripeti un pezzo»: tocchi all'inizio e alla fine di un passaggio difficile e lo ripete finché vuoi.
- Testo ingrandibile (A− / A+), schermo che resta acceso mentre suona, tema scuro automatico.
- «Scarica per l'uso senza internet»: la parte resta sul telefono e si prova anche senza rete (non installa l'app: per quello vedi «Installare l'app sul telefono»).

## Come è fatta la cartella

```
coro-prove/
├── index.html, app.js, style.css    l'app
├── sw.js, manifest.webmanifest      per installarla e usarla senza rete
├── icone/
├── brani/
│   ├── catalogo.json                l'elenco dei brani (lo scrive lo script)
│   └── canto-di-prova/              un brano = una cartella
│       ├── testo.lrc
│       ├── soprano-suonata.mp3   soprano-cantata.mp3
│       ├── contralto-suonata.mp3 contralto-cantata.mp3
│       ├── tenore-suonata.mp3    tenore-cantata.mp3
│       └── basso-suonata.mp3     basso-cantata.mp3
└── strumenti/
    ├── genera_catalogo.py           prepara i brani e aggiorna l'elenco
    └── prova_locale.py              apre l'app sul computer per provarla
```

## Aggiungere un brano

### 1. Portare gli audio sul computer

Il modo più semplice è **WhatsApp Web** sul computer (web.whatsapp.com):
apri la chat del coro, passa sopra ogni audio, freccetta ▾ → **Scarica**.
I file finiscono in `~/Scaricati`.

In alternativa, dal telefono: tieni premuto l'audio → Condividi → pCloud (o Drive),
poi li prendi dal computer. Sul telefono Android WhatsApp li tiene in
*Memoria interna → Android → media → com.whatsapp → WhatsApp → Media → WhatsApp Audio*
(o *WhatsApp Documents* se sono stati mandati come documento).

### 2. Metterli in una cartella del brano

Crea una cartella dentro `brani/` con un nome semplice, senza spazi e accenti,
per esempio `brani/lode-al-signore/`, e sposta lì gli 8 audio.

### 3. Dire di che parte è ogni audio

Se i file hanno già un nome chiaro (es. «Tenori con voce guida.opus») lo script
li riconosce da solo. Le parole che capisce:
- voce: *soprano/soprani, contralto/contralti/alto, tenore/tenori, basso/bassi*
- versione: *suonata/base/musica* oppure *cantata/voce/guida*

Se invece hanno i nomi di WhatsApp (es. `WhatsApp Audio 2026-11-20 at 18.03.12.ogg`)
c'è una scorciatoia: la maestra li manda sempre nello stesso ordine
(soprani solo musica, soprani con voce, contralti…, tenori…, bassi…). Quindi:

```
cd ~/Progetti/coro-prove
python3 strumenti/genera_catalogo.py --in-ordine
```

Lo script mostra quale parte assegnerebbe a ogni file, in base all'ordine di arrivo,
e rinomina solo se rispondi `s`.

Se l'ordine non torna (manca un file, ne è arrivato uno in più), usa invece:

```
python3 strumenti/genera_catalogo.py --rinomina
```

Fa partire ogni audio e chiede: `s` `c` `t` `b` per la voce,
`m` (solo musica) o `v` (con voce guida) per la versione.

### 4. Scrivere il testo

Nella cartella del brano crea `testo.lrc` (un normale file di testo):

```
[ti:Lode al Signore]

# Strofa 1
Prima riga del testo
Seconda riga del testo

# Ritornello
Riga del ritornello
```

- `[ti:...]` è il titolo che si vede nell'app.
- `[nota:...]` aggiunge una riga informativa sotto il titolo (autore, tonalità, avvertenze).
- Le righe che cominciano con `#` sono titoletti (Strofa, Ritornello…).
- `//` alla fine di una riga indica un respiro: nell'app compare il segno ’.
- Le righe che cominciano con `;` sono commenti e non si vedono.
- Una riga vuota separa le strofe.
- Il ritornello, se si canta più volte, va scritto ogni volta che si canta.

**Inni con più strofe sulla stessa musica** (come il 260): le basi contengono
una sola strofa. Se nella cartella c'è il file `tempi.json`, con l'inizio di ogni
frase per ciascuna delle 8 registrazioni, l'app mostra i pulsanti Strofa 1, 2, 3.
Il testo della strofa scelta si illumina frase per frase. A fine base si può
ripartire da soli con la strofa successiva. In questo caso ogni strofa nel
`testo.lrc` deve avere tante righe quante sono le frasi in `tempi.json`.

**Sincronizzazione (facoltativa, si può fare dopo):** per far illuminare le righe
mentre la musica va, metti all'inizio di ogni riga il momento in cui si comincia
a cantarla, in minuti:secondi.centesimi:

```
[00:03.00]Prima riga del testo
[00:09.50]Seconda riga del testo
```

Senza tempi il testo si vede lo stesso, ma non scorre da solo.

### 5. Aggiornare l'elenco

```
python3 strumenti/genera_catalogo.py
```

Converte gli audio in MP3 leggeri (circa mezzo MB al minuto, vanno bene anche
sugli iPhone), sposta gli originali in `_originali/` (che non viene pubblicata)
e riscrive `brani/catalogo.json`. Alla fine dice se c'è qualcosa da sistemare.

### 6. Provare sul computer

```
python3 strumenti/prova_locale.py
```

Si apre il browser su http://localhost:8000. Ctrl+C nel terminale per fermarlo.

## Pubblicare l'app (una volta sola)

Il modo gratuito più semplice è **GitHub Pages**:

1. Crea un account su github.com (se non ce l'hai) e un nuovo repository,
   per esempio `coro-prove`, **pubblico**.
2. Dalla cartella del progetto:
   ```
   cd ~/Progetti/coro-prove
   git init
   git add .
   git commit -m "Prima versione"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/coro-prove.git
   git push -u origin main
   ```
3. Su GitHub: **Settings → Pages → Branch: main / (root) → Save**.
4. Dopo un minuto l'app è su `https://TUO-UTENTE.github.io/coro-prove/`.
   Quel link si manda nel gruppo WhatsApp del coro.

Per i brani successivi basta:

```
python3 strumenti/genera_catalogo.py
git add .
git commit -m "Nuovo brano"
git push
```

I coristi vedono il brano nuovo la prossima volta che aprono l'app.

**Nota:** il sito è pubblico per chi ha il link (non compare sui motori di ricerca
se non lo si pubblica altrove). Meglio avvisare la maestra che le sue basi
saranno raggiungibili così.

## Installare l'app sul telefono

Indirizzo: https://pilucaalb.github.io/coro-prove/

- **Android**: aprire il link con **Chrome** (non con Edge o con il browser Xiaomi o Samsung),
  menu **⋮** in alto a destra → **Aggiungi a schermata Home** → **Installa**.
- **iPhone**: aprire il link con **Safari** → **Condividi** → **Aggiungi alla schermata Home**.
- **Telefoni Xiaomi / Redmi / POCO**: se dopo «Installa» l'icona non compare, il telefono
  sta bloccando le scorciatoie. Impostazioni → App → Gestisci app → Chrome →
  Altre autorizzazioni → **Scorciatoie della schermata Home** → Consenti. Poi riprovare.
  Controllare anche l'elenco di tutte le app: a volte l'icona finisce lì.
