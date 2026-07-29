/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { raw } from 'hono/utils/html';

export function FlushPage(props?: {}) {
	const doctypeTag = raw('<!DOCTYPE html>');

	return (
		<>
			{doctypeTag}
			<html>
				<head>
					<meta charset="UTF-8" />
					<meta name="application-name" content="Misskey" />
					<title>Clear preferences and cache</title>
				</head>
				<body>
					<div id="msg"></div>
					<script src="/static-assets/misc/flush.js"></script>
				</body>
			</html>
		</>
	);
}
