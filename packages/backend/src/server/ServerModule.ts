/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module } from '@nestjs/common';
import { EndpointsModule } from '@/server/api/EndpointsModule.js';
import { CoreModule } from '@/core/CoreModule.js';

// Other Server Services
import { FileServerService } from './FileServerService.js';
import { HealthServerService } from './HealthServerService.js';
import { NodeinfoServerService } from './NodeinfoServerService.js';
import { ServerService } from './ServerService.js';
import { WellKnownServerService } from './WellKnownServerService.js';
import { ActivityPubServerService } from './ActivityPubServerService.js';

// API Server Services
import { ApiCallService } from './api/ApiCallService.js';
import { GetterService } from './api/GetterService.js';
import { ApiLoggerService } from './api/ApiLoggerService.js';
import { ApiServerService } from './api/ApiServerService.js';
import { RateLimiterService } from './api/RateLimiterService.js';
import { StreamingApiServerService } from './api/StreamingApiServerService.js';
import { OpenApiServerService } from './api/openapi/OpenApiServerService.js';

// Web Server Services
import { ClientServerService } from './web/ClientServerService.js';
import { HtmlTemplateService } from './web/HtmlTemplateService.js';
import { FeedService } from './web/FeedService.js';
import { UrlPreviewService } from './web/UrlPreviewService.js';
import { ClientLoggerService } from './web/ClientLoggerService.js';

// Auth Server Services
import { AuthenticateService } from './auth/AuthenticateService.js';
import { AuthServerService } from './auth/AuthServerService.js';
import { SigninApiService } from './auth/SigninApiService.js';
import { SigninService } from './auth/SigninService.js';
import { SignupApiService } from './auth/SignupApiService.js';

// OAuth Services
import { OAuth2ProviderService } from './oauth/OAuth2ProviderService.js';

// Streaming API Services
import MainStreamConnection from '@/server/api/stream/Connection.js';
import { MainChannel } from './api/stream/channels/main.js';
import { AdminChannel } from './api/stream/channels/admin.js';
import { AntennaChannel } from './api/stream/channels/antenna.js';
import { ChannelChannel } from './api/stream/channels/channel.js';
import { DriveChannel } from './api/stream/channels/drive.js';
import { GlobalTimelineChannel } from './api/stream/channels/global-timeline.js';
import { HashtagChannel } from './api/stream/channels/hashtag.js';
import { HomeTimelineChannel } from './api/stream/channels/home-timeline.js';
import { HybridTimelineChannel } from './api/stream/channels/hybrid-timeline.js';
import { LocalTimelineChannel } from './api/stream/channels/local-timeline.js';
import { QueueStatsChannel } from './api/stream/channels/queue-stats.js';
import { ServerStatsChannel } from './api/stream/channels/server-stats.js';
import { UserListChannel } from './api/stream/channels/user-list.js';
import { RoleTimelineChannel } from './api/stream/channels/role-timeline.js';
import { ChatUserChannel } from './api/stream/channels/chat-user.js';
import { ChatRoomChannel } from './api/stream/channels/chat-room.js';
import { ReversiChannel } from './api/stream/channels/reversi.js';
import { ReversiGameChannel } from './api/stream/channels/reversi-game.js';
import { NoteStreamingHidingService } from './api/stream/NoteStreamingHidingService.js';

@Module({
	imports: [
		EndpointsModule,
		CoreModule,
	],
	providers: [
		// Other Server Services
		FileServerService,
		HealthServerService,
		NodeinfoServerService,
		ServerService,
		WellKnownServerService,
		ActivityPubServerService,

		// API Server Services
		ApiCallService,
		GetterService,
		ApiLoggerService,
		ApiServerService,
		RateLimiterService,
		StreamingApiServerService,
		OpenApiServerService,

		// Web Server Services
		ClientServerService,
		HtmlTemplateService,
		FeedService,
		UrlPreviewService,
		ClientLoggerService,

		// Auth Server Services
		AuthenticateService,
		AuthServerService,
		SigninApiService,
		SigninService,
		SignupApiService,

		// OAuth Services
		OAuth2ProviderService,

		// Streaming API Services
		MainStreamConnection,
		MainChannel,
		AdminChannel,
		AntennaChannel,
		ChannelChannel,
		DriveChannel,
		GlobalTimelineChannel,
		HashtagChannel,
		HomeTimelineChannel,
		HybridTimelineChannel,
		LocalTimelineChannel,
		QueueStatsChannel,
		ServerStatsChannel,
		UserListChannel,
	 	RoleTimelineChannel,
		ChatUserChannel,
		ChatRoomChannel,
		ReversiChannel,
		ReversiGameChannel,
		NoteStreamingHidingService,
	],
	exports: [
		ServerService,
	],
})
export class ServerModule {}
