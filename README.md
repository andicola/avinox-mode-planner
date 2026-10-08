# Avinox Mode Planner

Pagina web per chi pedala con un motore **DJI Avinox M2/M2S** (sviluppata su una Amflow PR Carbon Pro con batteria RS800). Fa due cose:

1. **Schema modalità**: dati peso, cadenza e potenza, ti dà per ECO, AUTO, TRAIL e TURBO solo i numeri da inserire nell'app Avinox (livello o range di livelli, potenza max, coppia max e parametri dinamici).
2. **Percorso, batteria e avvisi**: carichi il GPX/KML del giro e la pagina lo divide in tratti per pendenza. Per ogni tratto sceglie la modalità e stima la batteria lungo il percorso. Dove la modalità cambia crea un waypoint. Scarichi un GPX con traccia e waypoint da importare su Wikiloc e da seguire con l'Apple Watch.

La bici non può cambiare modalità da sola in base al percorso. Il piano serve a dirti quando cambiarla, con pochi avvisi mirati: AUTO regola già l'assistenza dentro il suo range.

Tutto gira nel browser: il file GPX non viene caricato da nessuna parte.

## Come si usa

- **Online**: https://andicola.github.io/avinox-mode-planner/ (quando GitHub Pages è attivo, vedi sotto).
- **In locale**: apri `index.html` nel browser, oppure `npm run serve` e vai su http://localhost:8080.
- **Docker**:

  ```sh
  docker build -t avinox-mode-planner .
  docker run -d -p 8080:80 --name avinox-mode-planner avinox-mode-planner
  ```

- **File unico**: `npm run build:single` crea `dist/avinox-mode-planner.html` con lo script incorporato, da aprire anche offline.

### Dal file al polso

1. Inserisci nell'app Avinox i valori dello schema. AUTO e TRAIL hanno un livello minimo e uno massimo.
2. Carica il GPX del giro, scegli la carica alla partenza e la batteria che vuoi avere all'arrivo, poi scarica il GPX con i waypoint.
3. Importa il GPX su Wikiloc e controlla che i waypoint ci siano.
4. **Prova prima un giro corto**: Wikiloc documenta l'avviso quando esci dalla traccia; la vibrazione dell'Apple Watch ai waypoint va verificata sul campo.

## Come funziona

### Schema modalità

È il porting lato browser di `/api/calculate` di [avinox-setup-app](https://github.com/lucad87/avinox-setup-app). I test confrontano i risultati con quelli del server originale.

- Livelli di assistenza: tabella della community per l'M2S (livello 3 = 100%, 4 = 150%, 8 = 300%, 13 = 700% della spinta del ciclista). Non sono specifiche DJI.
- Bande per modalità: ECO 1–7 e TURBO 8–15 (fissi), AUTO 3–11 e TRAIL 6–13 (range). Ogni modalità è ancorata alla precedente.
- Potenza a passi di 50 W, coppia a passi di 5 Nm (i valori che l'app accetta). La coppia è dimensionata per una salita a 60 rpm.
- Stili: Risparmio, Bilanciato, Enduro (W/kg per modalità del calcolatore originale).
- Potenza e cadenza: se non le conosci, scegli quanto spingi (Poco, Normale, Tanto). La potenza viene stimata dal tuo peso con 1,2, 1,6 o 2,2 W/kg e la cadenza fissata a 80 rpm. Con "Lo so" inserisci i tuoi valori, per esempio letti sul display Avinox durante una salita regolare. La cadenza pesa poco: tra 60 e 100 rpm lo schema non cambia, perché la coppia è dimensionata a 60 rpm.

### Tratti e waypoint

- La traccia viene ricampionata ogni 10 m. La quota è mediata su ±40 m e la pendenza misurata su finestre di 140 m.
- Fasce: discesa < −2%, pianura < 3%, ondulato 3–7%, salita 7–12%, ripida 12–18%, estrema > 18%. Ogni fascia ha una modalità, modificabile. In discesa la modalità resta quella del tratto prima.
- I tratti troppo corti vengono assorbiti dal vicino più simile. Una salita che alza l'assistenza resta se è lunga almeno 300/400/600 m (avvisi molti/equilibrati/pochi). Gli altri tratti devono arrivare a 500/800/1200 m.
- Il waypoint di una salita arriva con un anticipo regolabile (0–200 m). Facoltativo: avvisi per le rampe brevi (80–300 m oltre il 14%) da fare col Boost.

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

## Sviluppo

```sh
npm test               # node:test, nessuna dipendenza
npm run build:single   # dist/avinox-mode-planner.html
```

- `index.html`: interfaccia (HTML, CSS e JS senza framework).
- `planner.js`: calcolo delle modalità, lettura GPX/KML, tratti, energia, export GPX e zip. Funziona sia nel browser sia in Node.
- `test/`: test del calcolo, del piano, del GPX e dello zip.

### GitHub Pages

Il workflow `.github/workflows/pages.yml` pubblica la pagina a ogni push su `main`. Per attivarlo una volta: **Settings → Pages → Source: GitHub Actions**.

## Crediti e licenza

- Calcolo delle modalità e modello di consumo: [avinox-setup-app](https://github.com/lucad87/avinox-setup-app) di Luca Donnaloia ([versione online](https://avinox-calculator.lucad.cloud/)), licenza MIT.
- Licenza MIT, vedi [LICENSE](LICENSE).
- Progetto non ufficiale, non affiliato a DJI né ad Amflow. I valori sono stime: verificali con i tuoi giri.

---

## English

A browser-only tool for **DJI Avinox M2/M2S** e-bikes. It turns rider weight, cadence and power into the numbers to enter in the Avinox app for ECO, AUTO, TRAIL and TURBO, ported from [avinox-setup-app](https://github.com/lucad87/avinox-setup-app). It also splits a GPX/KML route into gradient sections and picks a mode for each. It estimates the battery along the way, lowers the assistance when needed to arrive with the reserve you choose, and exports a GPX with mode-change waypoints for Wikiloc and Apple Watch. Run it by opening `index.html`, with Docker (`docker build -t avinox-mode-planner . && docker run -p 8080:80 avinox-mode-planner`) or on GitHub Pages. MIT licensed.
