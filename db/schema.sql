-- Contatori anonimi delle funzioni usate (database D1 "avinox-planner-stats", binding DB).
-- Una riga per giorno, azione e dettaglio: nessun dato personale.
CREATE TABLE IF NOT EXISTS counts (
    day TEXT NOT NULL,
    name TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name, detail)
);
