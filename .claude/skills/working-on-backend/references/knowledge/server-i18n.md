# サーバー側の多言語対応 (メールなど)

サーバーが生成する文言 (メールなど) は、クライアント用の `/locales` ではなく **`/locales-backend`** に置く。

## 構成

| もの | 場所 |
|---|---|
| 翻訳の原文 (手で編集してよいのはこれだけ) | [locales-backend/ja-JP.yml](../../../../../locales-backend/ja-JP.yml) |
| 他言語 | `locales-backend/{lang}.yml`。Crowdin の配信先なので **手で編集しない** |
| 型 `BackendLocale` (生成物、commit する) | [src/i18n/autogen/locale.d.ts](../../../../../packages/backend/src/i18n/autogen/locale.d.ts) |
| 実行時に読む JSON (生成物) | `built/_backend_locales_/{lang}.json` (リポジトリ直下) |
| 生成スクリプト | [scripts/build-locales.mjs](../../../../../packages/backend/scripts/build-locales.mjs) |
| 翻訳の読み込み | [ServerI18nService](../../../../../packages/backend/src/core/ServerI18nService.ts) |
| メール本文 (kitajs) | [src/core/email/templates.tsx](../../../../../packages/backend/src/core/email/templates.tsx) |

`ja-JP.yml` を変更したら `pnpm --filter backend build-locales` で型と JSON を再生成する (`pnpm dev` 中は自動)。翻訳が未配信の言語は ja-JP にフォールバックする。

## メールを送る

```ts
// 受信者の言語はプロフィールの言語設定。ユーザーが不明なら null (= en-US)
this.emailService.sendLocalizedEmail(profile.email, profile.lang, i18n => resetPasswordEmail(i18n, link));
```

新しいメールは `templates.tsx` に関数を追加する。翻訳文も Crowdin 経由の外部入力なので、**JSX の子要素には必ず `safe` を付ける** (`@kitajs/html` が自動でエスケープするのは属性だけ)。

## やってはいけないこと

- 翻訳 JSON を `import` / `require` で読む: モジュールキャッシュに残り続け、rolldown ではバンドルに全言語が埋め込まれる
- `ServerI18nService.get()` の戻り値をフィールドやモジュール変数に保持する: 全言語がメモリに溜まっていく。呼び出したスコープの中だけで使う
- backend から `/locales` (クライアント向け) を読む
