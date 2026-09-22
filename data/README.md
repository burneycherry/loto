# data

`tools/fetch_mizuho.js` が書き出す当せん番号の保存先です。
GitHub Actions（`.github/workflows/fetch-loto.yml`）が1日1回実行され、
以下のファイルを更新します。

| ファイル | 内容 |
| - | - |
| `loto6.json` | ロト6の当せん番号（新しい回が先頭、最大120件） |
| `loto7.json` | ロト7の当せん番号（新しい回が先頭、最大120件） |

形式は次のとおりで、アプリの「データ」タブの書き出しJSONと同じです。

```json
[
 { "no": 1900, "date": "2024-05-02", "main": [3,11,19,24,35,41], "bonus": [7] }
]
```

初回のワークフロー実行までは `loto6.json` / `loto7.json` は存在しません。
手元で作る場合は `node tools/fetch_mizuho.js both data 120` を実行してください。
