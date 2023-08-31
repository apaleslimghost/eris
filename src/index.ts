import fs from 'fs/promises'
import path from 'path'
import Slack from '@slack/web-api'

const archiveRoot = process.argv[2]

if(!archiveRoot) {
	throw new Error('Usage: eris <archive folder>')
}

const files = await fs.readdir(archiveRoot)

const channels = files.filter(file => !file.endsWith('.json') && !file.startsWith('.'))

async function readChannels(): Promise<Slack.ChannelsListResponse['channels']> {
	return JSON.parse(await fs.readFile(path.join(archiveRoot, 'channels.json'), 'utf-8'))
}

async function readChannelMessages(channel: string): Promise<Slack.ChannelsHistoryResponse['messages']> {
	const channelDir = path.join(archiveRoot, channel)
	const archives = await fs.readdir(channelDir)

	return (await Promise.all(
		archives.map(
			async archive => JSON.parse(
				await fs.readFile(path.join(channelDir, archive), 'utf-8')
			)
		)
	)).flat()
}

async function readUsers(): Promise<Slack.UsersListResponse['members']> {
	return JSON.parse(await fs.readFile(path.join(archiveRoot, 'users.json'), 'utf-8'))
}

console.log(
	await readChannels()
)
