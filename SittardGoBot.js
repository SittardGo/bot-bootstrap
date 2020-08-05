/* jshint esversion: 6 */
const Discord = require('discord.js');
const EventBus = require('eventbusjs');
const ArgumentParser = require('argparse').ArgumentParser;
const fs = require('fs');

const EVENTS = {
    'READY'     : 'ready',
    'DEBUG'     : 'debug',
    'MESSAGE'   : 'message',
    'ERROR'     : 'error',
    'RECONNECT' : 'reconnect'
};

const REQUIRED_CONFIG_FIELDS = [
    'guild-id',
    'bot-token',
    'client-id',
    'version',
    'description',
];

const MAX_MESSAGE_LENGTH = 1996;

const CONFIG = {};

const TEAM_ICON_CACHE = {};
const TEAM_ICONS = [
    { team: 'valor', icon: 'valor' },
    { team: 'mystic', icon: 'mystic' },
    { team: 'instinct', icon: 'instinct' },
    { team: 'remote', icon: 'remote' },
];

const REGISTER_URL = 'https://discordapp.com/oauth2/authorize?&client_id={CLIENT_ID}&scope=bot&permissions=0';
const DEFAULT_ARGS = [
    [['-u', '--url'], {
        help: 'Get the url for registering the bot',
        action: 'storeConst',
        constant: true
    }],
    [['-g', '--generate'], {
        help: 'Generate a config file to populate',
        action: 'storeConst',
        constant: true
    }]
];

let userArgs     = {};
let cliArgParser = false;
let client       = false;
let waitingForReconnect = false;

class Bot {

    constructor(userConfig, cliArgs) {
        this.parseConfig(userConfig);

        client = new Discord.Client();
        this.initEvents();

        this.setUsage(CONFIG.description, CONFIG.version, cliArgs);

        // Exit if request for registration url
        if (this.getCliArgs().url) {
            console.log(this.getRegisterURL());
            process.exit(0);
        }

        // SHOULD FIX: Anti-pattern, but for now I don't
        // want the bots to die.
        process.on('uncaughtException', function (error) {
            console.log(error);
            EventBus.dispatch(EVENTS.ERROR, this, error);
        });
    }

    parseConfig(userConfig) {
        if (!userConfig) {
            this.setUsage();
            if (this.getCliArgs().generate) {
                this.generateConfig();
                console.log('Config file generated!');
                console.log('config.json is located in '+process.cwd());
                process.exit(0);
            }

            console.log('No configuration found!');
            console.log('You can generate a config file using the flag -g');
            process.exit(0);
        }

        REQUIRED_CONFIG_FIELDS.map(f => {
            if (!userConfig.hasOwnProperty(f)) {
                console.error('Config property "'+f+'" is missing');
                process.exit(0);
            }
        });

        for (let c in userConfig) {
            let v = c.replace(/-([a-z])/g, g => g[1].toUpperCase());
            CONFIG[v] = userConfig[c];
        }
    }

    generateConfig() {
        try {
            fs.writeFileSync(
                process.cwd()+'/config.json',
                fs.readFileSync(__dirname+'/config.default.json')
            );
        } catch(e) {
            console.log('Could not write config file!');
            console.log(e);
            process.exit(0);
        }
    }

    connect() {
        return client.login(CONFIG.botToken);
    }

    reconnect() {
        console.log('Destroying and connecting client...');
        client.destroy()
        .then(_ => {
            if (waitingForReconnect) {
                return;
            }

            console.log('waiting a few seconds before reconnect');
            waitingForReconnect = true;

            setTimeout(_ => {
                client = new Discord.Client();
                this.connect().then(_ => {
                    console.log('Dispatching reconnect event');
                    this.initEvents();
                    setTimeout(_ => EventBus.dispatch(EVENTS.RECONNECT, this), 1000);
                });
            }, 6000)
        });
    }

    initEvents() {
        client.on('ready', () => {
            console.log('Bot logged in');
            setTimeout(_ => client.setMaxListeners(1000), 1000);
            setTimeout(_ => EventBus.dispatch(EVENTS.READY, this), 1500);
        });

        client.on('debug', message => {
            EventBus.dispatch(EVENTS.DEBUG, this, message);
        });

        client.on('message', message => {
            EventBus.dispatch(EVENTS.MESSAGE, this, message);
        });

        client.on('disconnect', (msg, code) => {
            if (code === 0) {
                console.log('Login error', msg);
                return;
            }

            console.log('disconnect received');
            this.reconnect();
        });

        client.on('error', errEvent => {
            if (errEvent.error.code === 'ECONNRESET') {
                console.log('ECONNRESET Error:', errEvent);
                this.reconnect();
                return;
            }

            console.log('Client Error:', errEvent);
            this.reconnect();
        });
    }

    setUsage(description = '', version = '0', cliArgs = []) {
        cliArgParser = new ArgumentParser({
            description: description,
            version: version,
            addHelp: true,
        });

        DEFAULT_ARGS.concat(cliArgs).map(a => cliArgParser.addArgument(...a));
        userArgs = cliArgParser.parseArgs();
    }

    getCliArgs() {
        return userArgs;
    }

    getClient() {
        return client;
    }

    createEmbed(options = {}) {
        return new Discord.RichEmbed(options);
    }

    getAdminId(name) {
        if (!CONFIG.hasOwnProperty('adminIds')) {
            return false;
        }

        name = name.toLowerCase();

        if (!CONFIG.adminIds.hasOwnProperty(name)) {
            return false;
        }

        return CONFIG.adminIds[name];
    }

    getChannel(channel) {
        let channelId = this.getChannelId(channel);
        if (!channelId) {
            channelId = channel;
        }

        channel = client.channels.get(channelId);

        if (!channel) {
            return false;
        }

        return channel;
    }

    getChannelId(name) {
        if (!CONFIG.hasOwnProperty('channelIds')) {
            return false;
        }

        name = name.toLowerCase();

        if (!CONFIG.channelIds.hasOwnProperty(name)) {
            return false;
        }

        return CONFIG.channelIds[name];
    }

    reply(usrMsgObj, botMsgTxt, replyToBots = false) {
        if (!replyToBots && usrMsgObj.author.bot) {
            return;
        }

        if (botMsgTxt.length > MAX_MESSAGE_LENGTH) {
            botMsgTxt = botMsgTxt.substr(0, MAX_MESSAGE_LENGTH)+'...';
        }

        return usrMsgObj.channel.send(botMsgTxt);
    }

    send(channel, message) {
        channel = this.getChannel(channel);

        if (!channel) {
            return false;
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            message = message.substr(0, MAX_MESSAGE_LENGTH)+'...';
        }

        return channel.send(message);
    }

    getMessageUsername(msgObj) {
        // Sometimes member is null, seems
        // API response related error
        if (!msgObj.member) {
            return 'unknown';
        }

        return (msgObj.member.nickname)?
            msgObj.member.nickname : msgObj.author.username;
    }

    getUsernameOfUserId(userId) {
        const guildUser = this.getUserById(userId);

        if (!guildUser) {
            return '';
        }

        if (guildUser.nickname) {
            return guildUser.nickname;
        }

        return guildUser.user.username;
    }

    getMsgAuthorId(msgObj) {
        return msgObj.author.id;
    }

    getMsgContent(msgObj) {
        return trim(msgObj.content);
    }

    getMsgChannelId(msgObj) {
        return msgObj.channel.id;
    }

    getGuildChannel(channelId, guildId = false) {
        guildId = (guildId)? guildId : CONFIG.guildId;

        try {
            return new Discord.GuildChannel(
                client.guilds.get(guildId),
                client.channels.get(channelId)
            );
        } catch(e) {
            console.log('Error getting channel', e);
            return false;
        }
    }

    getGuild(guildId = false, retryCount = 0) {
        retryCount++;
        guildId = (guildId)? guildId : CONFIG.guildId;
        let guild = client.guilds.get(guildId);

        if (!guild || !guild.available) {
            if (retryCount === 5) {
                throw 'could not get guild';
            }

            setTimeout(() => {
                guild = this.getGuild(guildId, retryCount);
            }, 200);
        }

        return guild
    }

    getUserById(userId, guildId = false) {
        return this.getGuild(guildId).members.get(userId);
    }

    getTeamIcon(team, guildId = false) {
        team = team.toLowerCase();

        let teamObj = TEAM_ICONS.find(t => t.team === team);
        if (!teamObj) {
            return '';
        }

        if (!TEAM_ICON_CACHE[team]) {
            TEAM_ICON_CACHE[team] =
                this.getGuild(guildId).emojis.find('name', teamObj.icon) || '';
        }

        return TEAM_ICON_CACHE[team];
    }

    getTeamOfMember(memberObj) {
        let memberTeam = '';

        memberObj.roles.map(r => {
            if (memberTeam) {
                return;
            }

            const role = r.name.toLowerCase();
            memberTeam = TEAM_ICONS.find(t => t.team === role);
        });

        return (memberTeam)? memberTeam.team : '';
    }

    getRegisterURL() {
        return REGISTER_URL.replace('{CLIENT_ID}', CONFIG.clientId);
    }

    getMaxMessageLength() {
        return MAX_MESSAGE_LENGTH;
    }

    userIsMod(memberObj) {
        if (!CONFIG.hasOwnProperty('modRoleNames')) {
            return false;
        }

        const res = memberObj.roles.filterArray((r) => {
            return CONFIG.modRoleNames.indexOf(r.name.toLowerCase()) > -1;
        });

        return res.length > 0;
    }

    userHasRole(memberObj, roleName) {
        roleName = roleName.toLowerCase();

        const res = memberObj.roles.filterArray((r) => {
            return r.name.toLowerCase() === roleName;
        });

        return res.length > 0;
    }

    on(type, cb, args) {
        if (!EVENTS.hasOwnProperty(type)) {
            console.trace(`Error: unknown event ${type}`);
            return;
        }

        if (typeof cb !== 'function') {
            console.trace('Error: provided callback not a function');
            return;
        }

        if (!args) {
            args = [];
        }

        EventBus.addEventListener(EVENTS[type], (event, ...eventArgs) => {
            cb(event, ...eventArgs.concat(args));
        });
    }
}

module.exports = {
    Bot, EVENTS
};
