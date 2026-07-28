/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { FILE_TYPE_BROWSERSAFE } from '@/const.js';
import { contentDisposition } from '@/misc/content-disposition.js';
import type { IImageStreamable } from '@/core/ImageProcessingService.js';
import type { Context as HonoContext } from 'hono';

export type RangeStream = {
	stream: fs.ReadStream;
	start: number;
	end: number;
	chunksize: number;
};

/** Node FS Streamから、Web標準のReadableStreamに変換するユーティリティ */
export function nodeStreamToWebStream(stream: Readable): ReadableStream<Uint8Array> {
	return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

/** Bufferから、Web標準のReadableStreamに変換するユーティリティ */
export function bufferToWebStream(data: Buffer): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(data));
			controller.close();
		},
	});
}

/**
 * Range リクエストに対応したストリームを作成する
 *
 * 解釈できないRangeや満たせないRangeの場合はnullを返す。
 * (RFC 9110では不正なRangeヘッダーは無視して全体を返してよいとされている)
 */
export function createRangeStream(rangeHeader: string, size: number, path: string): RangeStream | null {
	// 複数レンジ (bytes=0-1,4-5) には対応せず、単一レンジのみ受け付ける
	const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
	if (match == null || size <= 0) return null;

	const [, rawStart, rawEnd] = match;

	let start: number;
	let end: number;
	if (rawStart === '') {
		// 末尾からのバイト数指定 (bytes=-500)
		const suffixLength = Number(rawEnd);
		if (rawEnd === '' || suffixLength <= 0) return null;
		start = Math.max(size - suffixLength, 0);
		end = size - 1;
	} else {
		start = Number(rawStart);
		// ファイル末尾を超える終端は、実際の末尾へ丸める
		end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
	}

	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;

	return {
		stream: fs.createReadStream(path, { start, end }),
		start,
		end,
		chunksize: end - start + 1,
	};
}

/**
 * ストリームにcleanupハンドラを設定する
 * ストリームでない場合は即座にcleanupを実行する
 */
export function attachStreamCleanup(data: IImageStreamable['data'], cleanup: () => void): void {
	if ('pipe' in data && typeof data.pipe === 'function') {
		data.on('end', cleanup);
		data.on('close', cleanup);
	} else {
		cleanup();
	}
}

/**
 * MIME タイプがブラウザセーフかどうかに応じて Content-Type を返す
 */
export function getSafeContentType(mime: string): string {
	return FILE_TYPE_BROWSERSAFE.includes(mime) ? mime : 'application/octet-stream';
}

/**
 * Range リクエストを処理してストリームを返す
 * Range ヘッダーがない場合は通常のストリームを返す
 */
export function handleRangeRequest(
	ctx: HonoContext,
	size: number,
	path: string,
) {
	const rangeHeader = ctx.req.header('Range');
	if (rangeHeader != null) {
		const range = createRangeStream(rangeHeader, size, path);
		if (range != null) {
			ctx.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
			ctx.header('Accept-Ranges', 'bytes');
			ctx.header('Content-Length', range.chunksize.toString());
			ctx.status(206);
			return range.stream;
		}
	}
	return fs.createReadStream(path);
}

export type FileResponseOptions = {
	mime: string;
	filename: string;
	size?: number;
	cacheControl?: string;
};

/**
 * ファイルレスポンス用の共通ヘッダーを設定する
 */
export function setFileResponseHeaders(
	ctx: HonoContext,
	options: FileResponseOptions,
): void {
	ctx.header('Content-Type', getSafeContentType(options.mime));
	ctx.header('Cache-Control', options.cacheControl ?? 'max-age=31536000, immutable');
	ctx.header('Content-Disposition', contentDisposition('inline', options.filename));
	if (options.size !== undefined) {
		ctx.header('Content-Length', options.size.toString());
	}
}

/**
 * cleanup が必要なファイルかどうかを判定する型ガード
 */
export function needsCleanup<T extends { kind?: string; cleanup?: () => void }>(file: T): file is T & { cleanup: () => void } {
	return 'cleanup' in file && typeof file.cleanup === 'function';
}
