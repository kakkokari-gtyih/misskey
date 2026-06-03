import { execa, execaNode } from 'execa';
import type { ResultPromise } from 'execa';
import type { Plugin } from 'rolldown';

/**
 * Watchモード時にバックエンドの起動・停止制御を行うプラグイン
 */
export function backendDevServerPlugin(): Plugin {
	let backendProcess: ResultPromise | null = null;

	async function runBuildAssets() {
		await execa('pnpm', ['run', 'build-assets'], {
			cwd: '../../',
			stdout: process.stdout,
			stderr: process.stderr,
		});
	}

	async function killBackendProcess() {
		if (backendProcess) {
			backendProcess.catch(() => { }); // backendProcess.kill()によって発生する例外を無視するためにcatch()を呼び出す
			backendProcess.kill();
			await new Promise(resolve => backendProcess!.on('exit', resolve));
			backendProcess = null;
		}
	}

	return {
		name: 'backend-dev-server',
		async closeBundle() {
			await runBuildAssets();
			if (backendProcess) {
				await killBackendProcess();
			}
			backendProcess = execaNode('./built/entry.js', [], {
				stdout: process.stdout,
				stderr: process.stderr,
				env: {
					NODE_ENV: 'development',
				},
			});
		},
		async watchChange() {
			if (backendProcess) {
				await killBackendProcess();
				await runBuildAssets();
			}
		},
	};
}
