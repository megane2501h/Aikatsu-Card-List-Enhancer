# aikatsu-card-list-enhancer.user.js

## 概要
`aikatsu-card-list-enhancer.user.js`は、アイカツカードリストの機能を拡張するためのユーザースクリプトです。このスクリプトを使用することで、カードリストの検索性や利便性が大幅に向上します。

## 特徴
- カードリストのフィルタリング機能（タイプ/カテゴリー/レアリティ別）
- 各フィルター項目のカード枚数をリアルタイム表示
- 表示されたカードリストに対してテキスト検索機能
- シンプルな画像とカード名だけの表示モード
- 検索結果をページネーションなしで全表示
- **カード所持状況の管理機能**（クリックでカードの所持/未所持を切り替え）
- **所持カードデータのエクスポート/インポート機能**
- **所持状況でのフィルタリング**（全て/所持/未所持）
- **コレクション統計**（表示枚数、所持枚数、総所持枚数）
- カード名とIDをクリックでコピー
- フィルターをスティッキー表示で常に操作可能
- 画面幅を最大限に活用するフルワイド表示
- サーバーに負荷をかけずに全てローカルで処理

## インストール方法
1. ブラウザに拡張機能「Tampermonkey」または「Violentmonkey」などのユーザースクリプトマネージャをインストールします。
   - [Tampermonkey (Chrome・Edge)](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Tampermonkey (Firefox)](https://addons.mozilla.org/ja/firefox/addon/tampermonkey/)
2. スクリプトをインストールします：
   - このリポジトリの`aikatsu-card-list-enhancer.user.js`ファイルを開き、「Raw」ボタンをクリックします。
   - ユーザースクリプトマネージャが自動的にインストール画面を表示します。
3. インストール後、[アイカツ！公式](https://www.aikatsu.com/cardlist/) にアクセスすると自動的に機能が有効になります。

## 使い方

### シンプル表示/詳細表示の切り替え
- 画面右上のコントロールパネルにある「シンプル表示に切り替え」ボタンをクリックすると、カードの表示形式を切り替えられます。
  - シンプル表示：画像とカード名のみの軽量表示
  - 詳細表示：公式サイトのオリジナル表示

### カード所持状態の管理
- カード画像をクリックすると、そのカードの所持状態を切り替えられます
- 所持中のカードは緑色のマーカーと枠線で表示されます
- 画面上部の「全て/所持/未所持」ボタンでフィルタリングできます

### コレクションデータの管理
- 画面上部のボタンで以下の操作が可能です
  - 📤 ボタン：所持カードデータをCSVファイルとしてエクスポート
  - 📥 ボタン：CSVファイルまたはテキストリストからカードデータをインポート
  - 🗑️ ボタン：全ての所持データをクリア（要確認）

### コピー機能
- カード名やIDをクリックすると、テキストがクリップボードにコピーされます

### フルワイド表示
- シンプル表示モード時に「画面幅いっぱいに表示」にチェックを入れると、ブラウザの幅いっぱいにカードを表示できます

## CSVインポート/エクスポート形式
エクスポートされるCSVファイルは以下の形式です：
```
# アイカツカードコレクションデータ
# ※インポート時にはImageFileNameのみが必要です。CardNameとIDは参考用のデータです。
ImageFileName,CardName,ID
1604-01,アイスブルーフリルキャミソール,16 04-01
```

インポート時には以下の形式も受け付けます：
```
1604-01
1604-02
1604-03
```

## 注意事項
- 本スクリプトは非公式の拡張ツールであり、公式サイトの仕様変更により動作しなくなる可能性があります。
- カード所持データはブラウザのローカルストレージに保存されます。ブラウザのデータをクリアすると消去される可能性があるため、定期的にエクスポート機能でバックアップをとることをお勧めします。