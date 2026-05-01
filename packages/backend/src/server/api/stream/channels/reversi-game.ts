/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import type { MiReversiGame } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { ReversiService } from '@/core/ReversiService.js';
import { ReversiGameEntityService } from '@/core/entities/ReversiGameEntityService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { reversiUpdateKeys } from 'misskey-js';
import { REQUEST } from '@nestjs/core';
import { DI } from '@/di-symbols.js';
import type { MiLocalUser } from '@/models/User.js';
import type { UsersRepository } from '@/models/_.js';

@Injectable({ scope: Scope.TRANSIENT })
export class ReversiGameChannel extends Channel {
	public readonly chName = 'reversiGame';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private gameId: MiReversiGame['id'] | null = null;
	private userFull: MiLocalUser | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private reversiService: ReversiService,
		private reversiGameEntityService: ReversiGameEntityService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.gameId !== 'string' || this.user == null) {
			return false;
		}

		// JWTの情報だけでは足りないのでユーザー情報を完全に取得する
		this.userFull = await this.usersRepository.findOneBy({ id: this.user.id }) as MiLocalUser | null;
		if (this.userFull == null) {
			return false;
		}

		this.gameId = params.gameId;

		this.subscriber.on(`reversiGameStream:${this.gameId}`, this.send);

		return true;
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		switch (type) {
			case 'ready':
				if (typeof body !== 'boolean') return;
				this.ready(body);
				break;
			case 'updateSettings':
				if (!isJsonObject(body)) return;
				if (!this.reversiService.isValidReversiUpdateKey(body.key)) return;
				if (!this.reversiService.isValidReversiUpdateValue(body.key, body.value)) return;

				this.updateSettings(body.key, body.value);
				break;
			case 'cancel':
				this.cancelGame();
				break;
			case 'putStone':
				if (!isJsonObject(body)) return;
				if (typeof body.pos !== 'number') return;
				if (typeof body.id !== 'string') return;
				this.putStone(body.pos, body.id);
				break;
			case 'claimTimeIsUp': this.claimTimeIsUp(); break;
		}
	}

	@bindThis
	private async updateSettings<K extends typeof reversiUpdateKeys[number]>(key: K, value: MiReversiGame[K]) {
		if (this.user == null) return;

		this.reversiService.updateSettings(this.gameId!, this.userFull!, key, value);
	}

	@bindThis
	private async ready(ready: boolean) {
		if (this.user == null) return;

		this.reversiService.gameReady(this.gameId!, this.user, ready);
	}

	@bindThis
	private async cancelGame() {
		if (this.user == null) return;

		this.reversiService.cancelGame(this.gameId!, this.userFull!);
	}

	@bindThis
	private async putStone(pos: number, id: string) {
		if (this.user == null) return;

		this.reversiService.putStoneToGame(this.gameId!, this.userFull!, pos, id);
	}

	@bindThis
	private async claimTimeIsUp() {
		if (this.user == null) return;

		this.reversiService.checkTimeout(this.gameId!);
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off(`reversiGameStream:${this.gameId}`, this.send);
	}
}

