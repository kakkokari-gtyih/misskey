import type { StorageLayer } from './types';

export const localDatabase = {
	get(layer: StorageLayer, accountId: string | null, key: string): any {
		// レイヤーに応じたローカルのデータ読み込み
		// 'deviceAccount' の場合は accountId をプレフィックスにしたキーから解決する
		return null;
	},
	set(layer: StorageLayer, accountId: string | null, key: string, value: any): void {
		// レイヤーに応じたローカルへのデータ書き込み
	},
	async deleteAccountStorage(accountId: string): Promise<void> {
		// IndexedDB 等から、当該アカウントの 'deviceAccount' 空間のみを完全削除
	}
};
