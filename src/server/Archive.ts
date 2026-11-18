import { GameID } from "@openfront/engine-api/Schemas";
import { replacer } from "@openfront/shared/SharedUtil";
import {
  GameRecord,
  GameRecordSchema,
  PartialGameRecord,
} from "@openfront/shared/WireSchemas";
import z from "zod";
import { registeredSite } from "./ClusterCheckin";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

async function sendGameResultToDiscordBot(gameRecord: GameRecord) {
  try {
    const botUrl =
      process.env.BOT_API_URL ?? "http://openfront-bot:8080/api/game-result";
    let winnerName = "不明";
    let winnerClientID = "";
    let isNpcWinner = false;

    if (gameRecord.info.winner) {
      const [kind, id] = gameRecord.info.winner;
      if (kind === "player") {
        winnerClientID = id;
        const winnerPlayer = gameRecord.info.players.find(
          (p) => p.clientID === id,
        );
        if (winnerPlayer) {
          // ボット（persistentIDが無いか、またはボット名）の場合は一律NPC扱い
          if (
            !winnerPlayer.persistentID ||
            winnerPlayer.username.startsWith("Bot ")
          ) {
            winnerName = "NPC";
            isNpcWinner = true;
          } else {
            winnerName = winnerPlayer.username;
          }
        }
      } else if (kind === "team") {
        if (id === "Bot" || id.toLowerCase().includes("bot")) {
          winnerName = "NPC";
          isNpcWinner = true;
        } else {
          winnerName = `チーム ${id}`;
        }
      } else if (kind === "nation") {
        winnerName = "NPC"; // 国家AI・ボット国家の勝利は一律「NPC」
        isNpcWinner = true;
      }
    }

    const payload = {
      gameID: gameRecord.info.gameID,
      winner: winnerName,
      winnerClientID: isNpcWinner ? "NPC" : winnerClientID,
      isNpcWinner,
      gameMode: gameRecord.info.config?.gameMode ?? "FFA",
      durationSeconds: Math.round(gameRecord.info.duration ?? 0),
      players: gameRecord.info.players.map((p) => ({
        clientID: p.clientID,
        username:
          !p.persistentID || p.username.startsWith("Bot ") ? "NPC" : p.username,
        isWinner: isNpcWinner ? false : p.clientID === winnerClientID,
        stats: p.stats,
      })),
    };

    const res = await fetch(botUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload, replacer),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      log.info(`game result successfully forwarded to Discord bot`, {
        gameID: gameRecord.info.gameID,
      });
    } else {
      log.warn(`Discord bot responded with status ${res.status}`, {
        gameID: gameRecord.info.gameID,
      });
    }
  } catch (err) {
    log.warn(`could not send game result to Discord bot: ${err}`, {
      gameID: gameRecord.info.gameID,
    });
  }
}

// Waits before each retry of a failed archive POST. Without a retry, a 5xx or
// network blip during an API incident loses the game's stats for every player.
// The API's duplicate check isn't atomic, so a retry that overlaps a still-
// running attempt can apply the game's win/loss deltas twice: the first delay
// is kept well above ingest time to make that unlikely.
export const ARCHIVE_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

// Per attempt, so an API that accepts the connection and then hangs doesn't
// hold a retry for undici's 300 s default. Well above the API's slowest
// ingest: a large public game takes longer than 15 s to save, and an attempt
// abandoned mid-save leaves the game stored but its stats and XP unapplied,
// with the retry answered 409 as if it had been archived.
export const ARCHIVE_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Up to 25% jitter, so servers that failed together don't retry together.
const withJitter = (ms: number) => ms + Math.floor(Math.random() * ms * 0.25);

export async function archive(gameRecord: GameRecord) {
  void sendGameResultToDiscordBot(gameRecord);

  let gameID: GameID | undefined;
  let request: RequestInit;
  let url: string;
  // The caller doesn't await archive(), so nothing here may throw.
  try {
    gameID = gameRecord.info.gameID;
    const parsed = GameRecordSchema.safeParse(gameRecord);
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID,
      });
      return;
    }
    url = `${ServerEnv.jwtIssuer()}/game/${gameID}`;
    request = {
      method: "POST",
      body: JSON.stringify(gameRecord, replacer),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    };
  } catch (error) {
    log.error(`error archiving game record: ${error}`, { gameID });
    return;
  }
  const attempts = ARCHIVE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    let failure: string;
    let retryable: boolean;
    try {
      const response = await fetch(url, {
        ...request,
        signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
      });
      if (response.ok) return;
      failure = `${response.status} ${response.statusText}`;
      // The API answers 409 for a game it already holds: after a failed
      // attempt, that one most likely saved and only its response was lost.
      if (response.status === 409 && attempt > 1) {
        log.warn(
          `archive attempt ${attempt} got ${failure}, treating as already archived`,
          { gameID },
        );
        return;
      }
      // Other 4xx are schema or validation rejections: retrying won't help.
      retryable = response.status >= 500 || response.status === 429;
    } catch (error) {
      failure = `${error}`;
      retryable = true;
    }
    if (!retryable || attempt >= attempts) {
      log.error(
        `error archiving game record after ${attempt} attempt(s): ${failure}`,
        { gameID },
      );
      return;
    }
    log.warn(`archive attempt ${attempt} failed, retrying: ${failure}`, {
      gameID,
    });
    await sleep(withJitter(ARCHIVE_RETRY_DELAYS_MS[attempt - 1]));
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: ServerEnv.gitCommit(),
    subdomain: ServerEnv.subdomain(),
    domain: ServerEnv.domain(),
    site: registeredSite(),
  };
}
