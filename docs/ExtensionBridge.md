# OpenFrontIO リアルタイム戦況ブリッジ (`window.__openfrontBridge`) 仕様書

このドキュメントでは、OpenFrontIO クライアントがブラウザの `window.__openfrontBridge` に公開する**読み取り専用の戦況取得 API** の仕様と、ブラウザ拡張機能からの利用方法を説明します。

---

## 1. 特徴と設計方針

- **Pull 型（オンデマンド参照）**: 拡張機能側がメソッドを呼んだ瞬間だけクライアントのメモリ上にある `GameView`・`TransformHandler` を参照します。
- **回線・通常プレイへの負荷ゼロ**: サーバーへの追加通信は一切発生せず、拡張機能を使っていないプレイヤー（モバイル回線など）の動作やフレームレートには影響しません。
- **カメラ座標変換対応**: マップ上のワールド座標 `(x, y)` とブラウザ画面上のピクセル座標 `(screenX, screenY)` を相互変換できるため、ズームやスクロールに追従するオーバーレイ描画が可能です。

---

## 2. API リファレンス (`window.__openfrontBridge`)

### `version: number`
- ブリッジの API バージョン（現在は `2`）。

### `isReady(): boolean`
- 試合が進行中（`GameView` が有効）であれば `true`、ロビー画面や試合終了後は `false` を返します。

---

### `getState(): BridgeStateSnapshot | null`
現在の戦況全体のスナップショットを返します（ゲーム待機中は `null`）。

| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `tick` | `number` | 現在のゲームティック番号 |
| `elapsedSeconds` | `number` | 試合開始からの経過秒数 |
| `gameOver` | `boolean` | 試合が終了しているか |
| `inSpawnPhase` | `boolean` | 初期スポーン選択フェーズ中か |
| `map` | `{ width: number, height: number }` | マップ全体の幅・高さ（ワールド座標） |
| `myPlayer` | `BridgePlayerInfo \| null` | 自プレイヤー情報（観戦中やスポーン前は `null`） |
| `players` | `BridgePlayerInfo[]` | 全プレイヤー（人間・Bot・国家AI）の配列 |
| `units` | `BridgeUnitInfo[]` | フィールド上の全施設・ユニット配列 |

#### `BridgePlayerInfo`
| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | `string` | プレイヤー ID |
| `smallID` | `number` | 領土・ユニット所有者判定に使う数値 ID |
| `name` | `string` | プレイヤー名 |
| `displayName` | `string` | 表示名 |
| `team` | `string \| null` | チーム名（個人戦は `null`） |
| `type` | `string` | プレイヤー種別（`"HUMAN"`, `"BOT"`, `"NATION"`） |
| `isAlive` | `boolean` | 生存しているか |
| `gold` | `number` | 所持ゴールド |
| `troops` | `number` | 保有兵力 |
| `numTilesOwned` | `number` | 保有領土タイル数 |
| `allies` | `number[]` | 同盟相手の `smallID` 配列 |

#### `BridgeUnitInfo`
| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | `number` | ユニット / 施設の一意 ID |
| `type` | `string` | 施設・ユニット種別（下記の「種別・定数一覧」を参照） |
| `x`, `y` | `number` | マップ上のワールド座標 |
| `ownerSmallID` | `number` | 所有プレイヤーの `smallID` |
| `troops` | `number` | ユニット兵力 |
| `level` | `number` | 施設のアップグレードレベル |
| `isInCooldown` | `boolean` | クールダウン中か（SAM の迎撃待ち・サイロの発射待ち等） |
| `isActive` | `boolean` | 有効状態か |

---

### `getTileInfo(x: number, y: number): BridgeTileInfo | null`
指定したワールド座標 `(x, y)` のタイル詳細を返します（範囲外・待機中は `null`）。

| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `x`, `y` | `number` | タイル座標 |
| `terrainType` | `number` | 地形種別コード（`0`: 平地, `1`: 高地, `2`: 山岳, `3`: 海, `4`: 通行不可） |
| `isLand` | `boolean` | 陸地かどうか |
| `isWater` | `boolean` | 水域かどうか |
| `hasFallout` | `boolean` | 核による放射性降下物があるか |
| `ownerSmallID` | `number \| null` | 所有者の `smallID`（中立地は `null`） |

---

### `getOwnerGrid(step?: number): BridgeOwnerGrid | null`
マップ全体の領土分布と地形を、`step` 間隔（デフォルト `4`）でサンプリングした配列として取得します。

| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `width`, `height` | `number` | 間引き後のグリッド幅・高さ |
| `step` | `number` | 使用された間引きステップ |
| `owners` | `number[]` | 長さ `width * height` の `smallID` 配列（未所有は `0`） |
| `terrain` | `number[]` | 長さ `width * height` の `terrainType` 配列 |

---

### `getCamera(): BridgeCameraInfo | null`
現在のカメラ（拡大率と中心オフセット）を取得します。オーバーレイ描画時の半径スケーリング（例: `射程 * scale`）に使えます。

| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `scale` | `number` | 現在のズーム倍率 |
| `offsetX`, `offsetY` | `number` | カメラ中心のワールド座標オフセット |

---

### `worldToScreen(x: number, y: number): BridgePoint | null`
マップ上のワールド座標 `(x, y)` を、現在のブラウザ表示領域上のピクセル座標 `{ x, y }` に変換します。

### `screenToWorld(screenX: number, screenY: number): BridgePoint | null`
ブラウザ画面上のピクセル座標 `(screenX, screenY)`（例: マウスカーソル位置）を、マップ上のワールド座標 `{ x, y }` に変換します。

---

## 3. Chrome / Edge 拡張機能での利用方法（Manifest V3）

ブラウザ拡張の Content Script はページ側と実行環境が分離されているため、`injector.js` から `web_accessible_resources` 経由で `content.js` をページコンテキストへ注入します。

### `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "My OpenFront Helper",
  "version": "0.1.0",
  "content_scripts": [
    {
      "matches": [
        "http://localhost:9000/*",
        "https://openfront.dk-core.com/*"
      ],
      "js": ["injector.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["content.js"],
      "matches": [
        "http://localhost:9000/*",
        "https://openfront.dk-core.com/*"
      ]
    }
  ]
}
```

### `injector.js`
```js
(() => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("content.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
})();
```

### ブラウザへの読み込み手順（Chrome / Edge）
1. 任意のフォルダ（例: `my-openfront-ext/`）を作成し、`manifest.json`・`injector.js`・`content.js` を配置する
2. ブラウザで `chrome://extensions`（Edge の場合は `edge://extensions`）を開く
3. 画面右上の **「デベロッパー モード」** をオンにする
4. **「パッケージ化されていない拡張機能を読み込む」** をクリックし、作成したフォルダを選択する
5. `https://openfront.dk-core.com/`（または `http://localhost:9000/`）をリロードしてゲームを開始する
   - コードを変更した場合は、拡張機能一覧カードの **更新アイコン（↻）** を押してからゲームページをリロードしてください

---

## 3.5 種別・定数一覧（フィルタ条件用）

### `units[].type`（`UnitType`）
| カテゴリ | 値（正確な文字列） | 説明 |
| :--- | :--- | :--- |
| **施設** | `"City"` | 都市 |
| | `"Factory"` | 工場 |
| | `"Port"` | 港 |
| | `"Defense Post"` | 防衛拠点 |
| | `"SAM Launcher"` | SAM タレット（迎撃ミサイル発射機） |
| | `"Missile Silo"` | ミサイルサイロ |
| **ユニット・艦船** | `"Transport"` | 輸送船 |
| | `"Warship"` | 軍艦 |
| | `"Trade Ship"` | 貿易船 |
| | `"Train"` | 列車 |
| | `"Shell"` | 砲弾 |
| | `"SAMMissile"` | 発射中の SAM 迎撃ミサイル |
| **核兵器** | `"Atom Bomb"` | 原子爆弾 |
| | `"Hydrogen Bomb"` | 水素爆弾 |
| | `"MIRV"` | 多弾頭ミサイル（本体） |
| | `"MIRV Warhead"` | MIRV 弾頭 |

### `terrainType`（`TerrainType`）
| 値 | 名称 | 説明 |
| ---: | :--- | :--- |
| `0` | `Plains` | 平地 |
| `1` | `Highland` | 高地 |
| `2` | `Mountain` | 山岳 |
| `3` | `Ocean` | 海・水域 |
| `4` | `Impassable` | 通行不可領域 |

### `players[].type`（`PlayerType`）
- `"HUMAN"`: 人間プレイヤー
- `"BOT"`: ゲーム内 Bot
- `"NATION"`: 国家 AI

---

## 4. 実装例：SAM 射程オーバーレイ & 突破数計算

以下は、敵 SAM タレットを `getState().units` から抽出し、カメラ座標変換 (`worldToScreen` / `getCamera`) を使って画面上の Canvas にリアルタイム描画する最小例です。

```js
(() => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function draw() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bridge = window.__openfrontBridge;
    if (!bridge || !bridge.isReady()) {
      requestAnimationFrame(draw);
      return;
    }

    const state = bridge.getState();
    const cam = bridge.getCamera();
    if (!state || !cam) {
      requestAnimationFrame(draw);
      return;
    }

    const myId = state.myPlayer?.smallID;
    // 例: 敵の稼働中 SAM を赤く表示（クールダウン中は黄色）
    for (const u of state.units) {
      if (!u.type.toLowerCase().includes("sam")) continue;
      if (u.ownerSmallID === myId) continue;

      const pos = bridge.worldToScreen(u.x, u.y);
      if (!pos) continue;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12 * cam.scale, 0, Math.PI * 2);
      ctx.strokeStyle = u.isInCooldown
        ? "rgba(250, 204, 21, 0.8)"
        : "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();
```

---

## 5. パフォーマンス上の注意
- `getOwnerGrid(1)` を毎フレーム呼ぶとブラウザが重くなるため、マップ解析は `step = 4` や `step = 8` で間引き、更新間隔も `500ms〜1000ms` 程度に抑えることを推奨します。
- 画面オーバーレイの座標追従だけなら `worldToScreen()` / `getCamera()` は非常に軽量なため `requestAnimationFrame` で呼び出しても問題ありません。
