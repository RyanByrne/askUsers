#!/usr/bin/env node

// Test Slack bot access and channel visibility
// Usage: node test-slack-access.js

import { WebClient } from '@slack/web-api'

const token = process.env.SLACK_BOT_TOKEN
const channelId = 'C090MGXKEDQ'

if (!token) {
  console.error('❌ SLACK_BOT_TOKEN environment variable is required')
  process.exit(1)
}

const client = new WebClient(token)

async function testSlackAccess() {
  console.log('🔍 Testing Slack Bot Access\n')

  // 1. Test bot authentication
  try {
    console.log('1️⃣ Testing bot authentication...')
    const auth = await client.auth.test()
    console.log('✅ Bot authenticated successfully')
    console.log(`   Bot User ID: ${auth.user_id}`)
    console.log(`   Bot User: ${auth.user}`)
    console.log(`   Team ID: ${auth.team_id}`)
    console.log(`   Team: ${auth.team}\n`)
  } catch (error) {
    console.error('❌ Bot authentication failed:', error.data?.error || error.message)
    return
  }

  // 2. List all channels the bot can see
  try {
    console.log('2️⃣ Listing all visible channels...')
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    })

    const channels = result.channels || []
    console.log(`✅ Found ${channels.length} channels\n`)

    // Check if our target channel is in the list
    const targetChannel = channels.find(ch => ch.id === channelId)
    if (targetChannel) {
      console.log(`✅ Target channel ${channelId} found:`)
      console.log(`   Name: #${targetChannel.name}`)
      console.log(`   Is Member: ${targetChannel.is_member}`)
      console.log(`   Is Private: ${targetChannel.is_private}`)
      console.log(`   Is Archived: ${targetChannel.is_archived}\n`)
    } else {
      console.log(`⚠️ Target channel ${channelId} NOT found in channel list\n`)
    }

    // List channels bot IS a member of
    const memberChannels = channels.filter(ch => ch.is_member)
    console.log(`3️⃣ Channels bot is member of (${memberChannels.length}):`)
    memberChannels.forEach(ch => {
      console.log(`   - #${ch.name} (${ch.id})`)
    })
    console.log('')

  } catch (error) {
    console.error('❌ Failed to list channels:', error.data?.error || error.message)
  }

  // 3. Try to access the specific channel directly
  try {
    console.log(`4️⃣ Attempting direct access to channel ${channelId}...`)
    const channelInfo = await client.conversations.info({
      channel: channelId
    })

    if (channelInfo.channel) {
      console.log('✅ Successfully accessed channel:')
      console.log(`   Name: #${channelInfo.channel.name}`)
      console.log(`   Is Member: ${channelInfo.channel.is_member}`)
      console.log(`   Created: ${new Date(channelInfo.channel.created * 1000).toISOString()}\n`)
    }
  } catch (error) {
    console.error(`❌ Cannot access channel ${channelId}:`, error.data?.error || error.message)
    console.log('\n💡 Possible solutions:')
    console.log('   1. Invite the bot to the channel: /invite @your-bot-name')
    console.log('   2. If private channel, ensure bot has groups:read scope')
    console.log('   3. Check if channel ID is correct')
    console.log('   4. Ensure bot is installed in the correct workspace\n')
  }

  // 4. Try to join the channel (only works for public channels)
  try {
    console.log(`5️⃣ Attempting to join channel ${channelId}...`)
    const joinResult = await client.conversations.join({
      channel: channelId
    })

    if (joinResult.ok) {
      console.log('✅ Successfully joined the channel!')
    }
  } catch (error) {
    console.error(`❌ Cannot join channel:`, error.data?.error || error.message)
    if (error.data?.error === 'method_not_supported_for_channel_type') {
      console.log('   → This is likely a private channel. Bot must be invited manually.')
    }
  }

  // 5. Test message history access (if we can access the channel)
  try {
    console.log(`\n6️⃣ Testing message history access for ${channelId}...`)
    const history = await client.conversations.history({
      channel: channelId,
      limit: 1
    })

    console.log('✅ Can access message history')
    console.log(`   Messages available: ${history.messages?.length || 0}`)
  } catch (error) {
    console.error(`❌ Cannot access message history:`, error.data?.error || error.message)
  }

  console.log('\n📋 Summary of Required Scopes:')
  console.log('   ✓ channels:read - View public channels')
  console.log('   ✓ groups:read - View private channels')
  console.log('   ✓ channels:history - Read public channel messages')
  console.log('   ✓ groups:history - Read private channel messages')
  console.log('   ✓ channels:join - Join public channels (optional)')
}

testSlackAccess().catch(console.error)