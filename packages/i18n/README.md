# Misskey i18n

Misskey の言語ファイルを扱うための共通ヘルパー群です。このパッケージ自身は翻訳データを持たず、どのディレクトリの言語ファイルを扱うかは利用側のパッケージが決めます。npm での外部配布は想定していません。

| エントリ | 用途 |
| --- | --- |
| `i18n` | 実行時 (ブラウザ / Node.js) から参照する言語一覧と型 (`Language`, `ILocale`, `ParameterizedString`) |
| `i18n/const` | 言語一覧 (`languages`) とフォールバック先 (`primaries`) |
| `i18n/build` | Node.js 専用のビルド用ユーティリティ。言語ファイルの読み込みとフォールバック解決 (`loadLocales`)、型の生成 (`generateLocaleInterface`)、整合性検査 (`verifyLocales`) |

どのエントリも、import しただけでは言語ファイルを読み込みません。

## 言語ファイルとその担当パッケージ

| 言語ファイル | 担当 | 生成物 |
| --- | --- | --- |
| `/locales` (クライアント向け) | `packages/frontend-shared` (`build.js` / `locales.js`) | `js/autogen/locale.d.ts` (型 `Locale`)、`built/_frontend_dist_/locales/*.json` |
