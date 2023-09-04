declare module 'komatsu' {
	type Labels = {
		pending: string,
		done: string,
		fail: string
	}

	type LogData = {
		status: 'pending' | 'fail' | 'done' | 'info',
		message: string,
		error?: Error,
	}

	export default class Logger {
		log(id: string, data: LogData): void
		logPromise<T>(promise: Promise<T>, labels: string | Labels): Promise<T>
	}
}
