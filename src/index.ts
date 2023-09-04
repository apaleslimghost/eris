import fs from 'fs/promises'
import path from 'path'
import Slack from '@slack/web-api'
import yargs from 'yargs/yargs'

const argv = yargs(process.argv.slice(2)).options({
	archive: { type: 'string', demandOption: true },
	token: {type: 'string', demandOption: true},
	guild: { type: 'string', demandOption: true}
}).parseSync()

async function getChannels(): Promise<string[]> {
	const files = await fs.readdir(argv.archive)
	return files.filter(file => !file.endsWith('.json') && !file.startsWith('.'))
}

async function readChannels(): Promise<Slack.ChannelsListResponse['channels']> {
	return JSON.parse(await fs.readFile(path.join(argv.archive, 'channels.json'), 'utf-8'))
}

async function readChannelMessages(channel: string): Promise<Slack.ChannelsHistoryResponse['messages']> {
	const channelDir = path.join(argv.archive, channel)
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
	return JSON.parse(await fs.readFile(path.join(argv.archive, 'users.json'), 'utf-8'))
}

import {CategoryChannel, Channel, ChannelType, Client, Events, GatewayIntentBits, Guild, GuildChannelCreateOptions, TextChannel, Webhook} from 'discord.js'

import Logger from 'komatsu'
const logger = new Logger()


const client = new Client({intents: [
	GatewayIntentBits.Guilds
]})

async function getWebhook(channel: TextChannel): Promise<Webhook> {
	const webhooks = await channel.fetchWebhooks()
	const webhook = webhooks.find(wh => wh.token)

	return webhook ?? channel.createWebhook({
		name: 'Eris'
	})
}

async function createOrReturnChannel(guild: Guild, options: GuildChannelCreateOptions): Promise<Channel> {
	const existingChannel = guild.channels.cache.find(c => c.name === options.name)

	if(!existingChannel) {
		return await logger.logPromise(
			guild.channels.create(options),
			`creating channel ${options.name}`
		)
	} else {
		logger.log(options.name, {status: 'info', message: `channel ${options.name} already exists`})
		return existingChannel
	}
}

client.once(Events.ClientReady, async () => {
	const guild = client.guilds.cache.get(argv.guild)
	if(!guild) throw new Error(`guild ${argv.guild} doesn't exist (or this bot doesn't have access to it)`)

	const slackChannels = await readChannels()
	if(!slackChannels) throw new Error(`couldn't read Slack archive channels.json`)

	const [slackCategory, archiveCategory] = await Promise.all([
		createOrReturnChannel(guild, { name: 'Slack', type: ChannelType.GuildCategory }),
		createOrReturnChannel(guild, { name: 'Slack (Archived)', type: ChannelType.GuildCategory })
	]) as [CategoryChannel, CategoryChannel]

	await Promise.all(slackChannels.map(async slackChannel => {
		const channel = await createOrReturnChannel(guild, { name: slackChannel.name ?? `slack-${slackChannel.id}` })
		if(channel.type === ChannelType.GuildText) {
			const category = slackChannel.is_archived ? archiveCategory : slackCategory
			logger.logPromise(
				channel.setParent(category, {lockPermissions: false}),
				`moving ${channel.name} to category ${category.name}`
			)
		}
	}))

	await Promise.all(slackChannels.map(async channel => {
		// const messages = await readChannelMessages(channel)
		const discordChannel = guild.channels.cache.find(c => c.name === channel)

		if(discordChannel && discordChannel.type === ChannelType.GuildText) {
			console.log(await getWebhook(discordChannel))
		}

		// for(const message of messages) {
		// 	await logger.logPromise(
		// 		discordChannel.
		// 	)
		// }
	}))
})

client.login(argv.token)
