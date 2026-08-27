/opt/homebrew/Library/Homebrew/cmd/shellenv.sh: line 18: /bin/ps: Operation not permitted
# Stampa lavorazione JOLLY

Il modello sorgente è `templates/JollyFlexa-rev5.xlsm`. Non viene mai modificato durante una stampa: per ogni pezzo il backend crea una copia in una directory temporanea, valorizza soltanto le celle di input e richiede a LibreOffice di ricalcolare le formule ed esportare il foglio in PDF. La copia temporanea viene eliminata al termine.

## Celle valorizzate

| Cella | Contenuto |
| --- | --- |
| `JOLLY!F1` | Nome cliente |
| `JOLLY!F3` | Riferimento `id ordine/numero pezzo` |
| `JOLLY!E8` | Colore |
| `JOLLY!E9` | Numero ante (`1` per ogni pagina/pezzo) |
| `JOLLY!H9` | Larghezza in millimetri |
| `JOLLY!I9` | Altezza in millimetri |

Le dimensioni vengono inserite nel gestionale in centimetri. La conversione è `millimetri = centimetri × 10`. Per esempio, altezza `227,7 cm` e larghezza `98,5 cm` diventano rispettivamente `2277 mm` in `I9` e `985 mm` in `H9`.

La quantità dell'ordine determina il numero di copie: quantità 2 produce due pagine JOLLY, quantità 3 ne produce tre. `F3` distingue i pezzi (`123/1`, `123/2`, ecc.).

## Compatibilità dati

`height_cm` e `width_cm` sono colonne nullable. All'avvio il backend deriva i valori storici dalle stringhe valide nel formato `altezza x larghezza`, lasciando invariata la colonna `dimensions`. Le stringhe non riconoscibili non vengono alterate.

Lo stato visivo usa `print_processed_at`, separato dallo stato di lavorazione. Gli ordini già marcati `Scaricato` vengono migrati conservando l'evidenziazione.

## Estensione futura

La generazione JOLLY è isolata in `services/jollyWorkbook.js`. Altre sottocategorie potranno avere un proprio adattatore con modello e mappatura celle dedicati, senza modificare il flusso generale della stampa multiordine.
