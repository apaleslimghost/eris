import fs from 'fs/promises'
import path from 'path'
import Slack, { Block } from '@slack/web-api'
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

type SlackMessage = Exclude<Slack.ChannelsHistoryResponse['messages'], undefined>[number] & { user_profile: Slack.UsersProfileGetResponse['profile'] }

async function readChannelMessages(channel: string): Promise<SlackMessage[]> {
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

type Member = Exclude<Slack.UsersListResponse['members'], undefined>[number]

async function readUsers(): Promise<Member[]> {
	return JSON.parse(await fs.readFile(path.join(argv.archive, 'users.json'), 'utf-8'))
}

import {CategoryChannel, Channel, ChannelType, Client, Events, GatewayIntentBits, Guild, GuildChannelCreateOptions, Message, MessagePayload, TextChannel, Webhook, WebhookMessageCreateOptions, inlineCode, italic} from 'discord.js'

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

const getUserName = (profile: Member['profile']): string => profile?.display_name || profile?.real_name || 'Slack User'

function parseMentions(text: string, users: Member[]): string {
	return text.replaceAll(/<@(U[\dA-Z]{8})>/g, (_, id) => {
		const user = users.find(u => u.id === id)
		return '@' + getUserName(user?.profile)
	})
}

// TODO: rich text, files, timestamps, reactions, threads
function renderDiscordMessage(message: SlackMessage, users: Member[], channel: Channel): WebhookMessageCreateOptions {
	if(message.subtype === 'channel_join') {
		const user = users.find(u => u.id === message.user)
		return {
			username: getUserName(user?.profile),
			avatarURL: user?.profile?.image_72,
			content: italic(`joined <#${channel.id}>`)
		}
	}

	return {
		username: getUserName(message.user_profile),
		avatarURL: message.user_profile?.image_72,
		content: parseMentions(message.text ?? '_empty message_', users)
	}
}

client.once(Events.ClientReady, async () => {
	const guild = client.guilds.cache.get(argv.guild)
	if(!guild) throw new Error(`guild ${argv.guild} doesn't exist (or this bot doesn't have access to it)`)

	const slackUsers = await readUsers()
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
		if(!channel.name) return
		const messages = await readChannelMessages(channel.name)
		const discordChannel = guild.channels.cache.find(c => c.name === channel.name)

		console.log({channel, messages: messages.length, discordChannel})

		if(messages && discordChannel && discordChannel.type === ChannelType.GuildText) {
			const webhook = await getWebhook(discordChannel)

			for(const message of messages) {
				try {
					await logger.logPromise(
						webhook.send(renderDiscordMessage(message, slackUsers, discordChannel)),
						`sending message ${message.text}`
					)
				} catch(error) {
					// TODO retry if it's a connection error
					if(error instanceof Error) {
						await fs.writeFile(path.join('src', 'fixtures', `${message.ts}.json`), JSON.stringify({error: error.stack, message}, null, '\t'))
					}
				}
			}
		}
	}))

	client.destroy()
})

client.login(argv.token)
