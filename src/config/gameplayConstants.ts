/**
 * gameplayConstants.ts
 * ─────────────────────
 * Costanti di bilanciamento per il gioco QIX-style.
 *
 * Questo file è pensato per un game designer o per future modifiche.
 * Ogni costante ha un commento che ne spiega l'effetto sul gameplay.
 *
 * ⚠️ NON modificare i valori qui senza testare l'impatto sul bilanciamento.
 */

// ──────────────────────────────────────────────────
// TIMING BASE DEL GIOCO
// ──────────────────────────────────────────────────

/** Frequenza di aggiornamento del game loop in millisecondi.
 *  Valori più bassi → gioco più fluido ma più esigente per la CPU.
 */
export const TICK_MS = 52;

/** Percentuale di area conquistata necessaria per completare un livello. */
export const TARGET_PERCENT = 75;

/** Vite iniziali del giocatore ad ogni nuova partita. */
export const START_LIVES = 3;

// ──────────────────────────────────────────────────
// DIMENSIONI GRIGLIA
// ──────────────────────────────────────────────────

/** Numero di celle orizzontali dell'arena. */
export const COLS = 88;

/** Numero di celle verticali dell'arena. */
export const ROWS = 60;

/** Dimensione di ogni cella in pixel (usata per il rendering canvas). */
export const CELL_PX = 10;

// ──────────────────────────────────────────────────
// ATTRACT MODE (schermata iniziale cabinato)
// ──────────────────────────────────────────────────

/** Durata della splash screen iniziale (ms). */
export const ATTRACT_SPLASH_MS = 10000;

/** Durata della demo autoplay (ms). */
export const ATTRACT_DEMO_MS = 20000;

/** Durata della schermata High Scores nel ciclo attract (ms). */
export const ATTRACT_SCORES_MS = 10000;

/** Durata del countdown "Livello Completato / Get Ready" (ms). */
export const LEVEL_COMPLETE_DURATION_MS = 5000;

// ──────────────────────────────────────────────────
// VELOCITÀ BASE DI QIX E SPARX
// ──────────────────────────────────────────────────

/** Velocità di base del QIX (celle/tick). Viene scalata con il livello. */
export const BASE_QIX_SPEED = 0.65;

/** Incremento velocità QIX per ogni livello successivo. */
export const QIX_SPEED_PER_LEVEL = 0.1;

/** Velocità di base degli Sparx (celle/tick). */
export const BASE_SPARK_SPEED = 0.45;

/** Incremento velocità Sparx per ogni livello successivo. */
export const SPARK_SPEED_PER_LEVEL = 0.12;

/** Numero massimo di Sparx presenti contemporaneamente. */
export const MAX_SPARKS = 6;

// ──────────────────────────────────────────────────
// SPAWN SPARX PER INATTIVITÀ
// ──────────────────────────────────────────────────

/** Dopo quanti tick di inattività (senza disegnare) nasce un nuovo Sparx.
 *  ~7 secondi con TICK_MS = 52.
 */
export const IDLE_NODRAW_THRESHOLD_TICKS = 135;

/** Limite massimo di Sparx extra generati per inattività (oltre MAX_SPARKS). */
export const EXTRA_SPAWN_SPARKS_LIMIT = 4;

// ──────────────────────────────────────────────────
// SPAWN ITEM (Power-ups e Minacce)
// ──────────────────────────────────────────────────

/** Ogni quanti tick si tenta di generare un nuovo item.
 *  ~5 secondi con TICK_MS = 52.
 */
export const ITEM_SPAWN_INTERVAL_TICKS = 100;

/** Probabilità (0–1) che un item venga generato quando il timer scatta. */
export const ITEM_SPAWN_CHANCE = 0.5;

/** Numero massimo di item contemporaneamente presenti nell'arena. */
export const MAX_ITEMS_ON_SCREEN = 6;

/** Durata di un item a schermo in tick prima che scompaia.
 *  ~20 secondi con TICK_MS = 52.
 */
export const ITEM_LIFETIME_TICKS = Math.ceil(20000 / TICK_MS);

// ──────────────────────────────────────────────────
// PESI DI SPAWN PER TIPO DI ITEM
// ──────────────────────────────────────────────────
// Il peso relativo determina la probabilità:
//   P(tipo) = peso_tipo / somma_tutti_i_pesi
//
// Rapporti richiesti dal prompt originale:
//   SHIELD   = 1/3 di COINS
//   ROCKET   = 1/3 di COINS
//   1-UP     = 1/10 di COINS
//   SLOW     = 1/3 di COINS
//   FAST_MONSTER = 1/3 di COINS

/** Peso di spawn per la moneta COINS (bonus punteggio). */
export const WEIGHT_COINS = 30;

/** Peso di spawn per SHIELD (protezione). 1/3 di COINS. */
export const WEIGHT_SHIELD = 10;

/** Peso di spawn per ROCKET (velocità penna). 1/3 di COINS. */
export const WEIGHT_ROCKET = 10;

/** Peso di spawn per 1-UP (vita extra). 1/10 di COINS. */
export const WEIGHT_ONE_UP = 3;

/** Peso di spawn per SLOW (rallentamento penna). 1/3 di COINS. */
export const WEIGHT_SLOW = 10;

/** Peso di spawn per FAST_MONSTER (nemici più veloci). 1/3 di COINS. */
export const WEIGHT_FAST_MONSTER = 10;

/** Peso di spawn per BOMB (minaccia esplosiva). Raro. */
export const WEIGHT_BOMB = 4;

/** Somma totale di tutti i pesi di spawn.
 *  Usata per calcolare la distribuzione: P(tipo) = peso / TOTAL_ITEM_WEIGHT.
 *  Valore calcolato: 30 + 10 + 10 + 3 + 10 + 10 + 4 = 77.
 */
export const TOTAL_ITEM_WEIGHT = WEIGHT_COINS + WEIGHT_SHIELD + WEIGHT_ROCKET + WEIGHT_ONE_UP + WEIGHT_SLOW + WEIGHT_FAST_MONSTER + WEIGHT_BOMB;

// ──────────────────────────────────────────────────
// DURATA DEGLI EFFETTI TEMPORANEI (in ms)
// ──────────────────────────────────────────────────

/** Durata dello scudo SHIELD (protezione da QIX e Sparx). */
export const SHIELD_DURATION_MS = 5000;

/** Durata del boost ROCKET (+30% velocità penna). */
export const ROCKET_DURATION_MS = 5000;

/** Durata del malus SLOW (-30% velocità penna). */
export const SLOW_DURATION_MS = 10000;

/** Durata del malus FAST_MONSTER (nemici più veloci). */
export const FAST_MONSTER_DURATION_MS = 30000;

// ──────────────────────────────────────────────────
// MODIFICATORI DI VELOCITÀ
// ──────────────────────────────────────────────────

/** Moltiplicatore velocità penna con effetto ROCKET attivo.
 *  +30% rispetto alla velocità normale.
 */
export const ROCKET_SPEED_MULTIPLIER = 1.30;

/** Moltiplicatore velocità penna con effetto SLOW attivo.
 *  -30% rispetto alla velocità normale (cioè 70% della normale).
 */
export const SLOW_SPEED_MULTIPLIER = 0.70;

/** Moltiplicatore velocità QIX/Sparx con effetto FAST_MONSTER attivo. */
export const FAST_MONSTER_SPEED_MULTIPLIER = 1.40;

// ──────────────────────────────────────────────────
// PUNTEGGIO
// ──────────────────────────────────────────────────

/** Punti base per ogni cella di area conquistata. */
export const POINTS_PER_AREA_CELL = 12;

/** Punti base per ogni cella della scia (trail) quando si chiude un'area. */
export const POINTS_PER_TRAIL_CELL = 5;

/** Punti base per ogni Sparx distrutto dalla chiusura di un'area. */
export const POINTS_PER_SPARK_DESTROYED_BASE = 2500;

/** Bonus punti per Sparx distrutto moltiplicato per il livello corrente. */
export const POINTS_PER_SPARK_DESTROYED_PER_LEVEL = 500;

/** Punti bonus raccolti raccogliendo un item COINS. */
export const POINTS_COINS_PICKUP = 1000;

/** Moltiplicatore punti per le aree conquistate in modalità SLOW (raddoppia). */
export const SLOW_AREA_POINTS_MULTIPLIER = 2;

// ──────────────────────────────────────────────────
// BOMB (MINACCIA ESPLOSIVA)
// ──────────────────────────────────────────────────

/** Raggio dell'esplosione della BOMB in celle (danno al territorio). */
export const BOMB_EXPLOSION_RADIUS_CELLS = 4;

/** Distanza massima in celle dalla BOMB entro la quale il giocatore muore. */
export const BOMB_KILL_DISTANCE_CELLS = 4;

// ──────────────────────────────────────────────────
// FUSE (MICCIA DELLA SCIA)
// ──────────────────────────────────────────────────

/** Dopo quanti tick di fermo durante il disegno la miccia avanza di 1 cella. */
export const FUSE_ADVANCE_TICKS = 3;
