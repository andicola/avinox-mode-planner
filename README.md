<img src="icons/icon.svg" width="88" alt="">

# Avinox Mode Planner

Pagina web per chi pedala con un motore **DJI Avinox M2 o M2S** (sviluppata su una Amflow PR Carbon Pro con batteria RS800), in italiano e in inglese. Fa due cose:

1. **Schema modalità**: dati peso, cadenza e potenza, ti dà per ECO, AUTO, TRAIL e TURBO solo i numeri da inserire nell'app Avinox (livello o range di livelli, potenza max, coppia max e parametri dinamici).
2. **Percorso, batteria e avvisi**: carichi il GPX/KML del giro e la pagina lo divide in tratti per pendenza. Per ogni tratto sceglie la modalità e stima la batteria lungo il percorso. Dove la modalità cambia crea un waypoint. Scarichi un GPX con traccia e waypoint da importare su Wikiloc e da seguire con l'Apple Watch.

La bici non può cambiare modalità da sola in base al percorso. Il piano serve a dirti quando cambiarla, con pochi avvisi mirati: AUTO regola già l'assistenza dentro il suo range.

Tutto gira nel browser: il file GPX non viene caricato da nessuna parte. È gratis e senza pubblicità; se ti è utile puoi offrirmi un caffè dalla pagina (3, 5 o 10 € o importo libero, con Apple Pay o carta tramite Stripe) oppure su [Ko-fi](https://ko-fi.com/andicola).

## Come si usa

- **Online**: https://avinox-planner.pages.dev (Cloudflare Pages, si aggiorna da solo a ogni push su `main`). Resta attivo anche https://andicola.github.io/avinox-mode-planner/, che mostra l'invito a spostarsi sul nuovo indirizzo portando i dati.
- **Come app sull'iPhone**: apri l'indirizzo con Safari, tocca **Condividi** e poi **Aggiungi alla schermata Home**. Si apre a tutto schermo con la sua icona e funziona anche senza rete (serve la rete solo per leggere il fondo da OpenStreetMap). Su Android: menu di Chrome → **Installa app**.
- **In locale**: apri `index.html` nel browser, oppure `npm run serve` e vai su http://localhost:8080.
- **Docker**:

  ```sh
  docker build -t avinox-mode-planner .
  docker run -d -p 8080:80 --name avinox-mode-planner avinox-mode-planner
  ```

- **File unico**: `npm run build:single` crea `dist/avinox-mode-planner.html` con gli script incorporati, da aprire anche offline.
- **Lingua**: il selettore IT/EN in alto cambia tutta la pagina, compresi i testi dei waypoint nel GPX. Alla prima apertura segue la lingua del telefono e poi ricorda la scelta.

### Dal file al polso

1. Inserisci nell'app Avinox i valori dello schema. AUTO e TRAIL hanno un livello minimo e uno massimo.
2. Carica il GPX del giro, scegli la carica alla partenza e la batteria che vuoi avere all'arrivo, poi scarica il GPX con i waypoint.
3. Importa il GPX su Wikiloc e controlla che i waypoint ci siano.
4. **Prova prima un giro corto**: Wikiloc documenta l'avviso quando esci dalla traccia; la vibrazione dell'Apple Watch ai waypoint va verificata sul campo.

## Come funziona

### Schema modalità

È il porting lato browser di `/api/calculate` di [avinox-setup-app](https://github.com/lucad87/avinox-setup-app). I test confrontano i risultati con quelli del server originale.

- Motore e batteria: **M2S** (130 Nm, 1300 W; Boost 150 Nm e 1500 W) o **M2** (110 Nm, 1100 W; Boost 125 Nm). Batterie FS600, FP700, FS800, RS600 e RS800: la capacità entra nella stima del giro e con l'M2S il Boost pieno da 1500 W c'è solo con FP700 o RS800.
- Livelli di assistenza: tabella della community per l'M2S, usata anche per l'M2 (livello 3 = 100%, 4 = 150%, 8 = 300%, 13 = 700% della spinta del ciclista). Non sono specifiche DJI.
- Bande per modalità: ECO 1–7 e TURBO 8–15 (fissi), AUTO 3–11 e TRAIL 6–13 (range). Ogni modalità è ancorata alla precedente.
- Potenza a passi di 50 W, coppia a passi di 5 Nm (i valori che l'app accetta). La coppia è dimensionata per una salita a 60 rpm.
- Stili: Risparmio, Bilanciato, Enduro (W/kg per modalità del calcolatore originale).
- Potenza e cadenza: se non le conosci, scegli quanto spingi (Poco, Normale, Tanto). La potenza viene stimata dal tuo peso con 1,2, 1,6 o 2,2 W/kg e la cadenza fissata a 80 rpm. Con "Lo so" inserisci i tuoi valori, per esempio letti sul display Avinox durante una salita regolare. La cadenza pesa poco: tra 60 e 100 rpm lo schema non cambia, perché la coppia è dimensionata a 60 rpm.

### Tratti e waypoint

- La traccia viene ricampionata ogni 10 m. La quota è mediata su ±40 m e la pendenza misurata su finestre di 140 m.
- Fasce: discesa < −2%, pianura < 3%, ondulato 3–7%, salita 7–12%, ripida 12–18%, estrema > 18%. Ogni fascia ha una modalità, modificabile. In discesa la modalità resta quella del tratto prima.
- I tratti troppo corti vengono assorbiti dal vicino più simile. Una salita che alza l'assistenza resta se è lunga almeno 300/400/600 m (avvisi molti/equilibrati/pochi). Gli altri tratti devono arrivare a 500/800/1200 m.
- Il waypoint di una salita arriva con un anticipo regolabile (0–200 m). Facoltativo: avvisi per le rampe brevi (80–300 m oltre il 14%) da fare col Boost.
- **Limite di waypoint**: Wikiloc accetta al massimo 25 waypoint per percorso (valore modificabile). Se il giro ne richiede di più, le lunghezze minime dei tratti crescono del 25% alla volta finché si rientra; gli avvisi Boost usano solo i posti rimasti e restano quelli delle rampe più ripide.

### Tutto in AUTO

In alternativa ai cambi di modalità puoi scegliere **Tutto in AUTO**: la pagina ti dice come regolare AUTO per quel giro, così parti e non cambi più.

- **Livello minimo**: quello di AUTO nello schema, che lavora in piano e sugli ondulati.
- **Livello massimo e potenza**: dimensionati sulle salite più dure del giro (90° percentile della pendenza in salita), interpolando i W/kg dello stile tra AUTO (6%), TRAIL (10%) e TURBO (15%). Nell'app AUTO arriva al livello 11.
- **Coppia**: la potenza a 60 rpm, corretta per l'aderenza del fondo come nel calcolatore originale (−15% su roccia, +15% su asfalto).
- **Avvio e accelerazione** più dolci (2) su fondo tecnico o fango, o quando oltre il 12% dei tratti è ripido.
- **Batteria**: il modello fa crescere l'aiuto dal livello minimo al massimo tra il 2% e la pendenza delle salite più dure. Se il giro non ci sta nella riserva, abbassa prima il livello massimo, poi il minimo.

La pagina mostra anche quanto consumeresti con l'AUTO dello schema, per confronto. Il GPX contiene solo il waypoint di partenza con le impostazioni e, se li attivi, gli avvisi per le rampe da Boost.

### Batteria

Usa lo stesso modello di consumo del calcolatore originale, applicato tratto per tratto:

- 3,8 Wh/km in piano più 0,24 Wh per metro di dislivello ogni 100 kg di peso del sistema;
- moltiplicato per il fattore del fondo (da 1,00 asfalto a 1,55 fango) e +35% sui tratti oltre il 12%;
- ogni modalità consuma in proporzione alla quota di lavoro del motore rispetto al mix di modalità DJI di serie su quel terreno.

La stima ha un margine di circa ±22%. Se con le modalità scelte arrivi sotto la riserva, il piano abbassa l'assistenza a giri successivi, dalla fascia più facile alla più ripida, finché ci stai. Le modalità scelte restano salvate. Se non basta nemmeno tutto in ECO, la pagina lo segnala e mostra il risultato con lo stile Risparmio.

### In sella: batteria prevista e minima

Ogni waypoint riporta nel nome la **batteria minima per finire il giro con la riserva** (per esempio "TRAIL · 2,4 km +210 m · min 38%"); nella descrizione c'è anche quella prevista. Quando l'orologio vibra guardi il display: se sei sotto la minima, scendi di una modalità o passa a **RISERVA**.

- **RISERVA** è una modalità personalizzata da creare nell'app Avinox (livello fisso, 1,10 W/kg, avvio e continuità al minimo), come la "ROUTE RESERVE" proposta dal calcolatore originale. La scheda modalità la calcola insieme alle altre.
- **Parti con almeno**: la carica che serve alla partenza per arrivare con la riserva, arrotondata ai 5%, e la stessa con il margine del modello. Spesso non serve caricare al 100%.
- **Temperatura**: sotto i 15 °C la capacità utile viene ridotta in modo prudente (95% tra 5 e 15 °C, 88% tra 0 e 5 °C, 80% sotto zero). Sono stime, non dati DJI.

### Fondo da OpenStreetMap

Con un GPX caricato, **Leggi il fondo da OpenStreetMap** invia a Overpass solo punti campionati della traccia (uno ogni 500 m) e classifica il fondo delle strade in sei voci (asfalto, sterrato compatto, terra, sassi e radici, roccia, fango). Ogni tratto usa il suo fondo per il consumo e, con AUTO, per la coppia; dove OSM non dice nulla vale il fondo prevalente. Il lettore è `surface-osm.js` del calcolatore originale, senza modifiche. Dentro l'artifact di claude.ai la richiesta è bloccata: funziona dall'indirizzo pubblico, dall'app installata o in locale.

### Taratura con i giri reali

Dopo un giro fatto seguendo il piano, scrivi la batteria alla partenza e all'arrivo e salva. Il fattore del giro è il consumo vero (in Wh, con la stessa correzione per il freddo) diviso per la stima del modello senza taratura. Le stime successive usano la mediana dei fattori tra 0,5 e 1,5; quelli fuori scala restano in lista ma non contano. I giri sono salvati solo nel browser.

## Sviluppo

```sh
npm test               # node:test, nessuna dipendenza
npm run build:single   # dist/avinox-mode-planner.html
```

- `index.html`: struttura e stile della pagina. I testi italiani dentro gli elementi con `data-i18n` vengono da `i18n.js`: dopo aver cambiato un testo esegui `npm run i18n:prefill` (i test controllano che siano allineati).
- `app.js`: logica dell'interfaccia (JS senza framework). Le donazioni si configurano in cima al file (`DONATE`): con i Payment Link di Stripe compaiono gli importi da pagare con Apple Pay o carta; senza link resta Ko-fi. Ogni link deve rimandare a `https://avinox-planner.pages.dev/?grazie=1`, che mostra il ringraziamento.
- `i18n.js`: tutti i testi dell'interfaccia in italiano e in inglese, con le stesse chiavi (verificato dai test).
- `planner.js`: calcolo delle modalità, lettura GPX/KML, tratti, energia, taratura, export GPX e zip, testi dei waypoint nelle due lingue. Funziona sia nel browser sia in Node.
- `surface-osm.js`: lettura del fondo da OpenStreetMap (dal calcolatore originale).
- `manifest.webmanifest`, `sw.js`, `icons/`: app installabile e funzionamento offline. Le icone si rigenerano con `python3 scripts/make-icons.py` (serve Playwright).
- `og-image.png`: anteprima dei link su Facebook, WhatsApp e simili (1200×630), rigenerabile con `python3 scripts/make-og-image.py`.
- `test/`: test del calcolo (M2S e M2), del piano, della batteria, della taratura, del GPX, dello zip, delle traduzioni e della pagina.

### Pubblicazione

Non c'è backend: la pagina è statica e tutti i calcoli girano nel browser. `npm run build:site` prepara in `_site/` i soli file pubblici.

- **Cloudflare Pages** (indirizzo principale): progetto `avinox-planner` collegato al repo, build command `npm run build:site`, output `_site`. Ogni push su `main` viene pubblicato su https://avinox-planner.pages.dev. Il file `_headers` fa ricontrollare sempre pagina e service worker.
- **GitHub Pages**: il workflow `.github/workflows/pages.yml` pubblica la stessa build su `andicola.github.io/avinox-mode-planner/`.

## Sostieni il progetto

L'app è gratuita, senza pubblicità e senza raccolta di dati. Se ti è utile puoi offrirmi un caffè: il pulsante **Sostieni il progetto** in alto porta agli importi (3, 5, 10 € o libero) che si pagano su Stripe con Apple Pay o carta, senza registrarsi. Con PayPal si passa da [Ko-fi](https://ko-fi.com/andicola).

## Crediti e licenza

- Calcolo delle modalità, modello di consumo e lettura del fondo da OpenStreetMap: [avinox-setup-app](https://github.com/lucad87/avinox-setup-app) di Luca Donnaloia ([versione online](https://avinox-calculator.lucad.cloud/)), licenza MIT.
- Licenza MIT, vedi [LICENSE](LICENSE).
- Progetto non ufficiale, non affiliato a DJI né ad Amflow. I valori sono stime: verificali con i tuoi giri.

---

## English

A browser-only tool for **DJI Avinox M2 and M2S** e-bikes, in English and Italian (IT/EN switch at the top of the page): https://avinox-planner.pages.dev It turns rider weight, cadence and power into the numbers to enter in the Avinox app for ECO, AUTO, TRAIL and TURBO, ported from [avinox-setup-app](https://github.com/lucad87/avinox-setup-app). It also splits a GPX/KML route into gradient sections and picks a mode for each. It estimates the battery along the way, lowers the assistance when needed to arrive with the reserve you choose, and exports a GPX with mode-change waypoints for Wikiloc and Apple Watch. Pick your motor (M2S or M2) and battery (FS600, FP700, FS800, RS600, RS800). Run it from the address above (add it to your Home Screen to use it as an app), by opening `index.html`, or with Docker (`docker build -t avinox-mode-planner . && docker run -p 8080:80 avinox-mode-planner`). Free, no ads, no data collection; if it helps you, you can [buy me a coffee on Ko-fi](https://ko-fi.com/andicola). Unofficial, not affiliated with DJI or Amflow. MIT licensed.
