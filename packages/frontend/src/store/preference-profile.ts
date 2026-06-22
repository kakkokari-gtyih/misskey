import { ref, computed } from 'vue';
import type { Ref, WritableComputedRef } from 'vue';
import type { Profile } from '@/store/types.js';
import { localDatabase } from '@/store/storage.js';
import { genId } from '@/utility/id.js';

export class PreferenceProfileManager {
	// 端末に保存されているすべてのプロファイルリスト (内部状態)
	private profiles = ref<Profile[]>([]);

	// 現在のアカウントでアクティブなプロファイルのID
	private activeProfileId = ref<string>('default');

	constructor(private currentAccountId: Ref<string | null>) {
		this.init();
	}

	// 初期化: 端末共通のプロファイルリストと、現在のアカウントのアクティブIDを読み込む
	private init() {
		const saved = localDatabase.get('device', null, '_all_profiles');
		if (saved && Array.isArray(saved)) {
			this.profiles.value = saved;
		} else {
			// 初期状態としてデフォルトプロファイルを用意
			this.profiles.value = [{ id: 'default', name: 'Default Profile', data: {} }];
		}

		// アカウントに紐づくアクティブプロファイルIDを取得
		this.activeProfileId.value =
			localDatabase.get('deviceAccount', this.currentAccountId.value, '_active_profile_id') ?? 'default';
	}

	// 1. プロファイルの作成 (Create)
	public createProfile(name: string, initialData: Record<string, any> = {}): Profile {
		const newProfile: Profile = {
			id: `profile_${Date.now()}_${genId()}`,
			name,
			data: JSON.parse(JSON.stringify(initialData)) // deep clone
		};

		this.registerProfile(newProfile);
		return newProfile;
	}

	// 2. プロファイルの登録 (Register / 永続化)
	public registerProfile(profile: Profile) {
		const index = this.profiles.value.findIndex(p => p.id === profile.id);
		if (index !== -1) {
			this.profiles.value[index] = profile;
		} else {
			this.profiles.value.push(profile);
		}

		// 端末共通領域（device）にプロファイルリストを保存
		localDatabase.set('device', null, '_all_profiles', this.profiles.value);
	}

	// 3. プロファイルの切り替え (Switch)
	public switchProfile(profileId: string) {
		const exists = this.profiles.value.some(p => p.id === profileId);
		if (!exists) return;

		this.activeProfileId.value = profileId;

		// アカウント固有領域（deviceAccount）に現在のアクティブIDを保存
		localDatabase.set('deviceAccount', this.currentAccountId.value, '_active_profile_id', profileId);
	}

	// --- PreferencesManager と連携するためのリアクティブな口群 ---

	// 作成済みの全プロファイルリストを公開 (読み取り専用)
	public get allProfiles() {
		return computed(() => this.profiles.value);
	}

	// 現在アクティブなプロファイルオブジェクト全体をリアクティブに返す
	public get currentProfile() {
		return computed(() => {
			return this.profiles.value.find(p => p.id === this.activeProfileId.value) || this.profiles.value[0];
		});
	}

	// PreferencesManager へ渡すための「実データ空間」へのリアクティブな参照
	public get currentProfileData(): WritableComputedRef<Record<string, any>> {
		return computed({
			get: () => this.currentProfile.value.data,
			set: (newData) => {
				const activeId = this.activeProfileId.value;
				const target = this.profiles.value.find(p => p.id === activeId);
				if (target) {
					target.data = newData;
					// 変更を永続化
					localDatabase.set('device', null, '_all_profiles', this.profiles.value);
				}
			}
		});
	}

	// アカウント切り替え（マルチアカウント時）に呼び出して、アクティブIDを再読み込みする
	public _trackAccountChange() {
		this.activeProfileId.value =
			localDatabase.get('deviceAccount', this.currentAccountId.value, '_active_profile_id') ?? 'default';
	}
}
