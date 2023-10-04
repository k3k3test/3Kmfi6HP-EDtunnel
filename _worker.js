// <!--GAMFC-->version base on commit 2b9927a1b12e03f8ad4731541caee2bc5c8f2e8e, time is 2023-06-22 15:09:37 UTC<!--GAMFC-END-->.

// How to generate your own UUID:
// [Windows] Press "Win + R", input cmd and run:  Powershell -NoExit -Command "[guid]::NewGuid()"
// [Linux] Run uuidgen in terminal
// in this project, we use proxyIPs generated subsctiption link with pureIPs.
const proxyIPs = ['cdn-all.xn--b6gac.eu.org', 'cdn.xn--b6gac.eu.org', 'cdn-b100.xn--b6gac.eu.org', 'edgetunnel.anycast.eu.org', 'cdn.anycast.eu.org'];

export let globalConfig = {
	userID: 'd342d11e-d424-4583-b36e-524ab1f0afa4',

	proxyIP: proxyIPs[Math.floor(Math.random() * proxyIPs.length)],

	// Time to wait before an outbound Websocket connection is established, in ms.
	openWSOutboundTimeout: 10000,

	// Since Cloudflare Worker does not support UDP outbound, we may try DNS over TCP.
	// Set to an empty string to disable UDP to TCP forwarding for DNS queries.
	dnsTCPServer: "8.8.4.4",

	// The order controls where to send the traffic after the previous one fails
	outbounds: [
		{
			protocol: "freedom"	// Compulsory, outbound locally.
		}
	]
};

// If you use this file as an ES module, you should set all fields below.
export let platformAPI = {
	/** 
	  * A wrapper for the TCP API, should return a Cloudflare Worker compatible socket.
	* The result is wrapped in a Promise, as in some platforms, the socket creation is async.
	* See: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
	  * @type {(host: string, port: number) => Promise<
	*    {
	*      readable: ReadableStream, 
	*      writable: {getWriter: () => {write: (data) => void, releaseLock: () => void}},
	*      closed: {Promise<void>}
	*    }>
	*  }
	  */
	connect: null,

	/** 
	  * A wrapper for the Websocket API.
	  * @type {(url: string) => WebSocket} returns a WebSocket, should be compatile with the standard WebSocket API.
	  */
	newWebSocket: null,

	/** 
	  * A wrapper for the UDP API, should return a NodeJS compatible UDP socket.
	* The result is wrapped in a Promise, as in some platforms, the socket creation is async.
	  * @type {(isIPv6: boolean) => Promise<
	*    {
	*      send: (datagram: any, offset: number, length: number, port: number, address: string, sendDoneCallback: (err: Error | null, bytes: number) => void) => void, 
	*      close: () => void,
	*      onmessage: (handler: (msg: Buffer, rinfo: RemoteInfo) => void) => void,
	*      onerror: (handler: (err: Error) => void) => void,
	*    }>
	*  }
	  */
	associate: null,
}

/**
 * Returns an outbound object based on the current position in the outbounds array.
 * @param {{index: number, serverIndex: number}} curPos - The current position in the outbounds array.
 * @returns {{
 *  protocol: string,
 *  address?: string,
 *  port?: number,
 *  user?: string,
 *  pass?: string,
 *  portMap?: {[key: number]: number},
 *  streamSettings?: {
 *    network: string,
 *    security: string,
 *    tlsSettings?: {
 *      allowInsecure?: boolean,
 *      serverName?: string,
 *      alpn?: string[],
 *      certificates?: {
 *        usage: string,
 *        certificateFile: string,
 *        keyFile: string
 *      }[]
 *    },
 *    wsSettings?: {
 *      path?: string,
 *      headers?: {[key: string]: string},
 *      queryString?: {[key: string]: string}
 *    },
 *    tcpSettings?: {
 *      header?: {[key: string]: string}
 *    },
 *    kcpSettings?: {
 *      mtu?: number,
 *      tti?: number,
 *      uplinkCapacity?: number,
 *      downlinkCapacity?: number,
 *      congestion?: boolean,
 *      readBufferSize?: number,
 *      writeBufferSize?: number,
 *      header?: {[key: string]: string}
 *    },
 *    quicSettings?: {
 *      security?: string,
 *      key?: string,
 *      header?: {[key: string]: string},
 *      tlsSettings?: {
 *        allowInsecure?: boolean,
 *        serverName?: string,
 *        alpn?: string[],
 *        certificates?: {
 *          usage: string,
 *          certificateFile: string,
 *          keyFile: string
 *        }[]
 *      }
 *    }
 *  }
 * }}
 */
function getOutbound(curPos) {
	if (curPos.index >= globalConfig.outbounds.length) {
		// End of the outbounds array
		return null;
	}

	const outbound = globalConfig.outbounds.at(curPos.index);
	let serverCount = 0;
	/** @type {[{}]} */
	let servers;
	/** @type {{address: string, port: number}} */
	let curServer;
	let retVal = { protocol: outbound.protocol };
	switch (outbound.protocol) {
		case 'freedom':
			break;

		case 'forward':
			retVal.address = outbound.address;
			retVal.portMap = outbound.portMap;
			break;

		case 'socks':
			servers = outbound.settings.vnext;
			serverCount = servers.length;
			curServer = servers.at(curPos.serverIndex);
			retVal.address = curServer.address;
			retVal.port = curServer.port;

			if (curServer.users && curServer.users.length > 0) {
				const firstUser = curServer.users.at(0);
				retVal.user = firstUser.user;
				retVal.pass = firstUser.pass;
			}
			break;

		case 'vless':
			servers = outbound.settings.vnext;
			serverCount = servers.length;
			curServer = servers.at(curPos.serverIndex);
			retVal.address = curServer.address;
			retVal.port = curServer.port;

			retVal.pass = curServer.users.at(0).id;
			retVal.streamSettings = outbound.streamSettings;
			break;

		default:
			throw new Error(`Unknown outbound protocol: ${outbound.protocol}`);
	}

	curPos.serverIndex++;
	if (curPos.serverIndex >= serverCount) {
		// End of the vnext array
		curPos.serverIndex = 0;
		curPos.index++;
	}

	return retVal;
}

/**
 * Determines whether the specified protocol can use UDP for outbound connections.
 * @param {string} protocolName - The name of the protocol to check.
 * @returns {boolean} - True if the protocol can use UDP for outbound connections, false otherwise.
 */
function canOutboundUDPVia(protocolName) {
	switch (protocolName) {
		case 'freedom':
			return platformAPI.associate != null; // Check if the 'associate' property is not null for the 'freedom' protocol
		case 'vless':
			return true; // The 'vless' protocol can always use UDP for outbound connections
	}
	return false; // If the protocol name does not match any of the cases above, return false by default
}

/**
 * Sets the configuration from environmental variables.
 * @param {{
 *  UUID: string, 
 *  PROXYIP: string,	// E.g. 8.8.8.8 If not set, use the IP of the request.
 *  PORTMAP: string,	// E.g. {443:8443}
 *  VLESS: string,		// E.g. vless://uuid@domain.name:port?type=ws&security=tls
 *  SOCKS5: string		// E.g. user:pass@host:port or host:port
 * }} env - The environmental variables object.
 */
export function setConfigFromEnv(request, env) {
	// Parse the URL of the incoming request
	const url = new URL(request.url);
	const path = url.pathname; // Get the path from the URL
	const query = url.searchParams; // Get the query parameters from the URL
	const sni = query.get('sni'); // Get the 'sni' parameter from the query
	const uuid = query.get('uuid'); // Get the 'uuid' parameter from the query
	const vlessPath = query.get('path'); // Get the 'path' parameter from the query

	// Log the extracted values for debugging purposes
	console.log(`path: ${path} sni: ${sni} uuid: ${uuid} vlessPath: ${vlessPath}`);

	// Create a vless:// URL based on the request parameters
	// Example: vless://uuid@domain.name:port?type=ws&security=tls
	// Default port is 443 for vless and 80 for vless over ws
	const vlessUrl = env.VLESS || `vless://${uuid}@${sni}:443?type=ws&security=tls&path=${vlessPath}`;


	globalConfig.userID = env.UUID || globalConfig.userID;

	globalConfig.outbounds = [
		{
			protocol: "freedom"	// Compulsory, outbound locally.
		}
	];

	if (env.PROXYIP) {
		let forward = {
			protocol: "forward",
			address: env.PROXYIP
		};

		if (env.PORTMAP) {
			forward.portMap = JSON.parse(env.PORTMAP);
		} else {
			forward.portMap = {};
		}

		globalConfig['outbounds'].push(forward);
	}

	// Example: vless://uuid@domain.name:port?type=ws&security=tls
	// if VLESS is set, use it, otherwise use the vlessUrl from the request
	// 
	if (vlessUrl) {
		try {
			const {
				uuid,
				remoteHost,
				remotePort,
				queryParams,
				descriptiveText
			} = parseVlessString(env.VLESS || vlessUrl);

			let vless = {
				"address": remoteHost,
				"port": remotePort,
				"users": [
					{
						"id": uuid
					}
				]
			};

			let streamSettings = {
				"network": queryParams['type'],
				"security": queryParams['security'],
			}

			if (queryParams['type'] == 'ws') {
				streamSettings.wsSettings = {
					"headers": {
						"Host": remoteHost
					},
					"path": decodeURIComponent(queryParams['path'])
				};
			}

			if (queryParams['security'] == 'tls') {
				streamSettings.tlsSettings = {
					"serverName": remoteHost,
					"allowInsecure": true
				};
			}

			globalConfig['outbounds'].push({
				protocol: "vless",
				settings: {
					"vnext": [vless]
				},
				streamSettings: streamSettings
			});
		} catch (err) {
			/** @type {Error} */
			let e = err;
			console.log(e.toString());
		}
	}

	// The user name and password should not contain special characters
	// Example: user:pass@host:port or host:port
	if (env.SOCKS5) {
		try {
			const {
				username,
				password,
				hostname,
				port,
			} = socks5AddressParser(env.SOCKS5);

			let socks = {
				"address": hostname,
				"port": port
			}

			if (username) {
				socks.users = [	// We only support one user per socks server
					{
						"user": username,
						"pass": password
					}
				]
			}

			globalConfig['outbounds'].push({
				protocol: "socks",
				settings: {
					"vnext": [socks]
				}
			});
		} catch (err) {
			/** @type {Error} */
			let e = err;
			console.log(e.toString());
		}
	}
}

export default {
	/**
	 * @param {import("@cloudflare/workers-types").Request} request
	 * @param {{UUID: string, PROXYIP: string}} env
	 * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
	 * @returns {Promise<Response>}
	 */
	async fetch(request, env, ctx) {
		if (env.LOGPOST) {
			// Redirect console logs to a specified endpoint, if LOGPOST environment variable is set
			redirectConsoleLog(env.LOGPOST, crypto.randomUUID());
		}
		try {
			// Set configuration from environment variables
			setConfigFromEnv(request, env);
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const url = new URL(request.url);
				switch (url.pathname) {
					case '/cf':
						// Return Cloudflare-specific data as a JSON response
						return new Response(JSON.stringify(request.cf), { status: 200 });
					case `/${globalConfig.userID}`: {
						// Return VLESS configuration based on the 'Host' header
						const vlessConfig = getVLESSConfig(request.headers.get('Host'));
						return new Response(`${vlessConfig}`, {
							status: 200,
							headers: {
								"Content-Type": "text/html;charset=utf-8",
							}
						});
					}
					case `/sub/${globalConfig.userID}`: {
						// Generate VLESS subscription config based on user ID and 'Host' header
						const url = new URL(request.url);
						const searchParams = url.searchParams;
						let vlessConfig = createVLESSSub(globalConfig.userID, request.headers.get('Host'));

						// If 'format' query param equals to 'clash', convert config to base64
						if (searchParams.get('format') === 'clash') {
							vlessConfig = btoa(vlessConfig);
						}

						// Construct and return response object
						return new Response(vlessConfig, {
							status: 200,
							headers: {
								"Content-Type": "text/plain;charset=utf-8",
							}
						});
					}
					default:
						// Return a response indicating an unknown path
						return new Response('EMOTIONAL DAMAGE', { status: 206 });
				}
			} else {
				/** @type {import("@cloudflare/workers-types").WebSocket[]} */
				// @ts-ignore
				// Handle WebSocket connections
				const webSocketPair = new WebSocketPair();
				const [client, webSocket] = Object.values(webSocketPair);

				webSocket.accept();
				const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
				const statusCode = vlessOverWSHandler(webSocket, earlyDataHeader);
				// Return a WebSocket response with the specified status code and client WebSocket
				return new Response(null, {
					status: statusCode,
					// @ts-ignore
					webSocket: client,
				});
			}
		} catch (err) {
			// Handle and return any errors as a response
			/** @type {Error} */ let e = err;
			return new Response(e.toString());
		}
	},
};


/**
 * Redirects console.log to a log server.
 * @param {string} logServer - The URL of the log server.
 * @param {string} instanceId - A UUID representing each instance.
 */
export function redirectConsoleLog(logServer, instanceId) {
	let logID = 0;
	const oldConsoleLog = console.log;

	console.log = async (data) => {
		oldConsoleLog(data);

		if (data == null) {
			return;
		}

		const msg = JSON.stringify(data);

		try {
			await fetch(logServer, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instanceId, logID: logID++, message: msg })
			});
		} catch (err) {
			oldConsoleLog(err.message);
		}
	};
}

try {
	// Dynamically import the 'cloudflare:sockets' module
	const module = await import('cloudflare:sockets');

	// Define a new connect function on the platformAPI object
	platformAPI.connect = async (address, port) => {
		// Call the 'connect' method from the imported module, passing the address and port
		return module.connect({ hostname: address, port: port });
	};

	// Define a newWebSocket function on the platformAPI object
	platformAPI.newWebSocket = (url) => new WebSocket(url);
} catch (error) {
	// Handle any error that occurs during the import or setting of platformAPI functions
	console.log('Not on Cloudflare Workers!');
}

/**
 * If you use this file as an ES module, you call this function whenever your Websocket server accepts a new connection.
 * 
 * @param {WebSocket} webSocket The established websocket connection to the client, must be an accepted
 * @param {string} earlyDataHeader for ws 0rtt, an optional field "sec-websocket-protocol" in the request header
 *                                  may contain some base64 encoded data.
 * @returns {number} status code
 */
export function vlessOverWSHandler(webSocket, earlyDataHeader) {
	let logPrefix = '';
	const log = (/** @type {string} */ info, /** @type {string | undefined} */ event) => {
		console.log(`[${logPrefix}] ${info}`, event || '');
	};

	// for ws 0rtt
	const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
	if (error !== null) {
		return 500;
	}

	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyData, null, log);

	let vlessHeader = null;

	// This source stream only contains raw traffic from the client
	// The vless header is stripped and parsed first.
	const fromClientTraffic = readableWebSocketStream.pipeThrough(new TransformStream({
		start() {
		},
		transform(chunk, controller) {
			if (vlessHeader) {
				controller.enqueue(chunk);
			} else {
				vlessHeader = processVlessHeader(chunk, globalConfig.userID);
				if (vlessHeader.hasError) {
					controller.error(`Failed to process Vless header: ${vlessHeader.message}`);
					controller.terminate();
					return;
				}
				const randTag = Math.round(Math.random() * 1000000).toString(16).padStart(5, '0');
				logPrefix = `${vlessHeader.addressRemote}:${vlessHeader.portRemote} ${randTag} ${vlessHeader.isUDP ? 'UDP' : 'TCP'}`;
				const firstPayloadLen = chunk.byteLength - vlessHeader.rawDataIndex;
				log(`First payload length = ${firstPayloadLen}`);
				if (firstPayloadLen > 0) {
					controller.enqueue(chunk.slice(vlessHeader.rawDataIndex));
				}
			}
		},
		flush(controller) {
		}
	}));

	/** @type {WritableStream | null}*/
	let remoteTrafficSink = null;

	// ws --> remote
	fromClientTraffic.pipeTo(new WritableStream({
		async write(chunk, controller) {
			// log(`remoteTrafficSink: ${remoteTrafficSink == null ? 'null' : 'ready'}`);
			if (remoteTrafficSink) {
				// After we parse the header and send the first chunk to the remote destination
				// We assume that after the handshake, the stream only contains the original traffic.
				// log('Send traffic from vless client to remote host');
				const writer = remoteTrafficSink.getWriter();
				await writer.ready;
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			// ["version", "length of additional info"]
			const vlessResponse = {
				header: new Uint8Array([vlessHeader.vlessVersion[0], 0]),
			}

			// Need to ensure the outbound proxy (if any) is ready before proceeding.
			remoteTrafficSink = await handleOutBound(vlessHeader, chunk, webSocket, vlessResponse, log);
			// log('Outbound established!');
		},
		close() {
			log(`readableWebSocketStream has been closed`);
		},
		abort(reason) {
			log(`readableWebSocketStream aborts`, JSON.stringify(reason));
		},
	})).catch((err) => {
		log('readableWebSocketStream pipeTo error', err);
	});

	return 101;
}

/**
 * Handles outbound connections.
 * @param {{isUDP: boolean, addressType: number, addressRemote: string, portRemote: number}} vlessRequest
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {{header: Uint8Array}} vlessResponse Contains information to produce the vless reponse, such as the header.
 * @param {function} log The logging function.
 * @returns {Promise<WritableStream | null>} a non-null fulfill indicates the success connection to the destination or the remote proxy server
 */
async function handleOutBound(vlessRequest, rawClientData, webSocket, vlessResponse, log) {
	let curOutBoundPtr = { index: 0, serverIndex: 0 };

	// Check if we should forward UDP DNS requests to a designated TCP DNS server.
	// The vless packing of UDP datagrams is identical to the one used in TCP DNS protocol,
	// so we can directly send raw vless traffic to the TCP DNS server.
	// TCP DNS requests will not be touched.
	// If fail to directly reach the TCP DNS server, UDP DNS request will be attempted on the other outbounds
	const forwardDNS = vlessRequest.isUDP && (vlessRequest.portRemote == 53) && (globalConfig.dnsTCPServer ? true : false);

	// True if we absolutely need UDP outbound, fail otherwise
	// False if we may use TCP to somehow resolve that UDP query
	const enforceUDP = vlessRequest.isUDP && !forwardDNS;

	/**
	 *  @param {WritableStream} writableStream 
	 *  @param {Uint8Array} firstChunk
	 */
	async function writeFirstChunk(writableStream, firstChunk) {
		const writer = writableStream.getWriter();
		await writer.write(firstChunk); // First write, normally is tls client hello
		writer.releaseLock();
	}

	async function direct() {
		if (enforceUDP) {
			// TODO: Check what will happen if addressType == VlessAddrType.DomainName and that domain only resolves to a IPv6
			const udpClient = await platformAPI.associate(vlessRequest.addressType == VlessAddrType.IPv6);
			const writableStream = makeWritableUDPStream(udpClient, vlessRequest.addressRemote, vlessRequest.portRemote, log);
			const readableStream = makeReadableUDPStream(udpClient, log);
			log(`Connected to UDP://${vlessRequest.addressRemote}:${vlessRequest.portRemote}`);
			await writeFirstChunk(writableStream, rawClientData);
			return {
				readableStream,
				writableStream
			};
		}

		let addressTCP = vlessRequest.addressRemote;
		if (forwardDNS) {
			addressTCP = globalConfig.dnsTCPServer;
			log(`Redirect DNS request sent to UDP://${vlessRequest.addressRemote}:${vlessRequest.portRemote}`);
		}

		const tcpSocket = await platformAPI.connect(addressTCP, vlessRequest.portRemote);
		tcpSocket.closed.catch(error => log('[freedom] tcpSocket closed with error: ', error.message));
		log(`Connecting to tcp://${addressTCP}:${vlessRequest.portRemote}`);
		await writeFirstChunk(tcpSocket.writable, rawClientData);
		return {
			readableStream: tcpSocket.readable,
			writableStream: tcpSocket.writable
		};
	}

	async function forward(proxyServer, portMap) {
		let portDest = vlessRequest.portRemote;
		if (typeof portMap === "object" && portMap[vlessRequest.portRemote] !== undefined) {
			portDest = portMap[vlessRequest.portRemote];
		}

		const tcpSocket = await platformAPI.connect(proxyServer, portDest);
		tcpSocket.closed.catch(error => log('[forward] tcpSocket closed with error: ', error.message));
		log(`Forwarding tcp://${vlessRequest.addressRemote}:${vlessRequest.portRemote} to ${proxyServer}:${portDest}`);
		await writeFirstChunk(tcpSocket.writable, rawClientData);
		return {
			readableStream: tcpSocket.readable,
			writableStream: tcpSocket.writable
		};
	}

	// TODO: known problem, if we send an unreachable request to a valid socks5 server, it will wait indefinitely
	// TODO: Add support for proxying UDP via socks5 on runtimes that support UDP outbound
	async function socks5(address, port, user, pass) {
		const tcpSocket = await platformAPI.connect(address, port);
		tcpSocket.closed.catch(error => log('[socks] tcpSocket closed with error: ', error.message));
		log(`Connecting to ${vlessRequest.isUDP ? 'UDP' : 'TCP'}://${vlessRequest.addressRemote}:${vlessRequest.portRemote} via socks5 ${address}:${port}`);
		try {
			await socks5Connect(tcpSocket, user, pass, vlessRequest.addressType, vlessRequest.addressRemote, vlessRequest.portRemote, log);
		} catch (err) {
			log(`Socks5 outbound failed with: ${err.message}`);
			return null;
		}
		await writeFirstChunk(tcpSocket.writable, rawClientData);
		return {
			readableStream: tcpSocket.readable,
			writableStream: tcpSocket.writable
		};
	}

	/**
	 * Start streaming traffic to a remote vless server.
	 * The first message must contain the query header plus part of the payload!
	 * The vless server responds to it with a response header plus part of the response from the destination.
	 * After the first message exchange, in the case of TCP, the streams in both directions carry raw TCP streams.
	 * Fragmentation won't cause any problem after the first message exchange.
	 * In the case of UDP, a 16-bit big-endian length field is prepended to each UDP datagram and then send through the streams.
	 * The first message exchange still applies.
	 * 
	 * @param {string} address 
	 * @param {number} port 
	 * @param {string} uuid 
	 * @param {{network: string, security: string}} streamSettings 
	 */
	async function vless(address, port, uuid, streamSettings) {
		try {
			checkVlessConfig(address, streamSettings);
		} catch (err) {
			log(`Vless outbound failed with: ${err.message}`);
			return null;
		}

		let wsURL = streamSettings.security === 'tls' ? 'wss://' : 'ws://';
		wsURL = wsURL + address + ':' + port;
		if (streamSettings.wsSettings && streamSettings.wsSettings.path) {
			wsURL = wsURL + streamSettings.wsSettings.path;
		}
		log(`Connecting to ${vlessRequest.isUDP ? 'UDP' : 'TCP'}://${vlessRequest.addressRemote}:${vlessRequest.portRemote} via vless ${wsURL}`);

		const wsToVlessServer = platformAPI.newWebSocket(wsURL);
		const openPromise = new Promise((resolve, reject) => {
			wsToVlessServer.onopen = () => resolve();
			wsToVlessServer.onclose = (code, reason) =>
				reject(new Error(`Closed with code ${code}, reason: ${reason}`));
			wsToVlessServer.onerror = (error) => reject(error);
			setTimeout(() => {
				reject({ message: `Open connection timeout` });
			}, globalConfig.openWSOutboundTimeout);
		});

		// Wait for the connection to open
		try {
			await openPromise;
		} catch (err) {
			log(`Cannot open Websocket connection: ${err.message}`);
			wsToVlessServer.close();
			return null;
		}

		const writableStream = new WritableStream({
			async write(chunk, controller) {
				wsToVlessServer.send(chunk);
			},
			close() {
				log(`Vless Websocket closed`);
			},
			abort(reason) {
				console.error(`Vless Websocket aborted`, reason);
			},
		});

		/** @type {(firstChunk : Uint8Array) => Uint8Array} */
		const headerStripper = (firstChunk) => {
			if (firstChunk.length < 2) {
				throw new Error('Too short vless response');
			}

			const responseVersion = firstChunk[0];
			const addtionalBytes = firstChunk[1];

			if (responseVersion > 0) {
				log('Warning: unexpected vless version: ${responseVersion}, only supports 0.');
			}

			if (addtionalBytes > 0) {
				log('Warning: ignored ${addtionalBytes} byte(s) of additional information in the response.');
			}

			return firstChunk.slice(2 + addtionalBytes);
		};

		const readableStream = makeReadableWebSocketStream(wsToVlessServer, null, headerStripper, log);
		const vlessReqHeader = makeVlessReqHeader(vlessRequest.isUDP ? VlessCmd.UDP : VlessCmd.TCP, vlessRequest.addressType, vlessRequest.addressRemote, vlessRequest.portRemote, uuid, rawClientData);
		// Send the first packet (header + rawClientData), then strip the response header with headerStripper
		await writeFirstChunk(writableStream, joinUint8Array(vlessReqHeader, rawClientData));
		return {
			readableStream,
			writableStream
		};
	}

	/**
	 * Tries each outbound method until a working one is found.
	 * @returns {Promise<WritableStream | null>} A writable stream if a working outbound is found, otherwise null.
	 */
	async function connectAndWrite() {
		const outbound = getOutbound(curOutBoundPtr);
		if (outbound == null) {
			log('Reached end of the outbound chain');
			return null;
		} else {
			log(`Trying outbound ${curOutBoundPtr.index}:${curOutBoundPtr.serverIndex}`);
		}

		if (enforceUDP && !canOutboundUDPVia(outbound.protocol)) {
			// This outbound method does not support UDP
			return null;
		}

		switch (outbound.protocol) {
			case 'freedom':
				return await direct();
			case 'forward':
				return await forward(outbound.address, outbound.portMap);
			case 'socks':
				return await socks5(outbound.address, outbound.port, outbound.user, outbound.pass);
			case 'vless':
				return await vless(outbound.address, outbound.port, outbound.pass, outbound.streamSettings);
		}

		return null;
	}

	// Try each outbound method until we find a working one.
	/** @type {{readableStream: ReadableStream, writableStream: WritableStream} | null} */
	let destRWPair = null;
	while (curOutBoundPtr.index < globalConfig.outbounds.length) {
		if (destRWPair == null) {
			destRWPair = await connectAndWrite();
		}

		if (destRWPair != null) {
			const hasIncomingData = await remoteSocketToWS(destRWPair.readableStream, webSocket, vlessResponse, log);
			if (hasIncomingData) {
				return destRWPair.writableStream;
			}

			// This outbound connects but does not work
			destRWPair = null;
		}
	}

	log('No more available outbound chain, abort!');
	safeCloseWebSocket(webSocket);
	return null;
}

/**
 * Make a source out of a UDP socket, wrap each datagram with vless UDP packing.
 * Each received datagram will be prepended with a 16-bit big-endian length field.
 * 
 * @param {UDPClient} udpClient The UDP socket to read from.
 * @param {(info: string) => void} log The logging function.
 * @returns {ReadableStream} Datagrams received will be wrapped and made available in this stream.
 */
function makeReadableUDPStream(udpClient, log) {
	return new ReadableStream({
		start(controller) {
			// Set up an event listener for incoming UDP datagrams
			udpClient.onmessage((message, info) => {
				// Log the received datagram information (you can uncomment this if needed)
				// log(`Received ${info.size} bytes from UDP://${info.address}:${info.port}`)

				// Prepend the length of the datagram as a 16-bit big-endian header
				const header = new Uint8Array([(info.size >> 8) & 0xff, info.size & 0xff]);
				const encodedChunk = joinUint8Array(header, message);

				// Enqueue the wrapped datagram into the ReadableStream
				controller.enqueue(encodedChunk);
			});

			// Set up an error handler for the UDP socket
			udpClient.onerror((error) => {
				// Log the UDP error and propagate it to the controller
				log('UDP Error: ', error);
				controller.error(error);
			});
		},
		cancel(reason) {
			// Log that the UDP ReadableStream has been closed and safely close the UDP socket
			log(`UDP ReadableStream closed:`, reason);
			safeCloseUDP(udpClient);
		},
	});
}


/**
 * Make a sink out of a UDP socket, the input stream assumes valid vless UDP packing.
 * Each datagram to be sent should be prepended with a 16-bit big-endian length field.
 * 
 * @param {*} udpClient The UDP socket to write to.
 * @param {string} addressRemote The remote address to send the datagrams to.
 * @param {port} portRemote The remote port to send the datagrams to.
 * @param {(info: string)=> void} log The logging function.
 * @returns {WritableStream} Write to this stream to send datagrams via UDP.
 */
function makeWritableUDPStream(udpClient, addressRemote, portRemote, log) {
	/** @type {Uint8Array} */
	let leftoverData = new Uint8Array(0);

	return new WritableStream({
		/** @param {ArrayBuffer} chunk */
		write(chunk, controller) {
			let byteArray = new Uint8Array(chunk);
			if (leftoverData.byteLength > 0) {
				// If we have any leftover data from previous chunk, merge it first
				byteArray = new Uint8Array(leftoverData.byteLength + chunk.byteLength);
				byteArray.set(leftoverData, 0);
				byteArray.set(new Uint8Array(chunk), leftoverData.byteLength);
			}

			let i = 0;
			while (i < byteArray.length) {
				if (i + 1 >= byteArray.length) {
					// The length field is not intact
					leftoverData = byteArray.slice(i);
					break;
				}

				// Big-endian
				const datagramLen = (byteArray[i] << 8) | byteArray[i + 1];

				if (i + 2 + datagramLen > byteArray.length) {
					// This UDP datagram is not intact
					leftoverData = byteArray.slice(i);
					break;
				}

				udpClient.send(byteArray, i + 2, datagramLen, portRemote, addressRemote, (err, bytes) => {
					if (err != null) {
						console.log('UDP send error', err);
						controller.error(`Failed to send UDP packet !! ${err}`);
						safeCloseUDP(udpClient);
					}
				});

				i += datagramLen + 2;
			}
		},
		close() {
			log(`UDP WritableStream closed`);
		},
		abort(reason) {
			console.error(`UDP WritableStream aborted`, reason);
		},
	});
}

// This function is used to safely close a UDP socket.
function safeCloseUDP(socket) {
	try {
		// Close the socket.
		socket.close();
	} catch (error) {
		// If an error occurs while closing the socket, log the error to the console.
		console.error('safeCloseUDP error', error);
	}
}

/**
 * Make a source out of a WebSocket connection.
 * A ReadableStream should be created before performing any kind of write operation.
 * 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer
 * @param {Uint8Array} earlyData Data received before the ReadableStream was created
 * @param {(firstChunk : Uint8Array) => Uint8Array} headStripper In some protocol like Vless, 
 *  a header is prepended to the first data chunk, it is necessary to strip that header.
 * @param {(info: string)=> void} log
 * @returns {ReadableStream} a source of Uint8Array chunks
 */
function makeReadableWebSocketStream(webSocketServer, earlyData, headStripper, log) {
	let readableStreamCancel = false;
	let headStripped = false;
	const stream = new ReadableStream({
		start(controller) {
			if (earlyData) {
				controller.enqueue(earlyData);
			}

			webSocketServer.addEventListener('message', (event) => {
				if (readableStreamCancel) {
					return;
				}

				// Make sure that we use Uint8Array through out the process.
				// On Nodejs, event.data can be a Buffer or an ArrayBuffer
				// On Cloudflare Workers, event.data tend to be an ArrayBuffer
				let message = new Uint8Array(event.data);
				if (!headStripped) {
					headStripped = true;

					if (headStripper != null) {
						try {
							message = headStripper(message);
						} catch (err) {
							readableStreamCancel = true;
							controller.error(err);
							return;
						}
					}
				}

				controller.enqueue(message);
			});

			// The event means that the client closed the client -> server stream.
			// However, the server -> client stream is still open until you call close() on the server side.
			// The WebSocket protocol says that a separate close message must be sent in each direction to fully close the socket.
			webSocketServer.addEventListener('close', () => {
				// client send close, need close server
				// if stream is cancel, skip controller.close
				safeCloseWebSocket(webSocketServer);
				if (readableStreamCancel) {
					return;
				}
				controller.close();
			}
			);
			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error: ' + err.message);
				controller.error(err);
			}
			);
		},

		pull(controller) {
			// if ws can stop read if stream is full, we can implement backpressure
			// https://streams.spec.whatwg.org/#example-rs-push-backpressure
		},
		cancel(reason) {
			// 1. pipe WritableStream has error, this cancel will called, so ws handle server close into here
			// 2. if readableStream is cancel, all controller.close/enqueue need skip,
			// 3. but from testing controller.error still work even if readableStream is cancel
			if (readableStreamCancel) {
				return;
			}
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});

	return stream;
}

// https://xtls.github.io/development/protocols/vless.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

/**
 * Processes the vless header and extracts relevant information such as the remote address, port, and command type.
 * @param {Uint8Array} vlessBuffer The vless header buffer.
 * @param {string} userID The expected userID.
 * @returns {{
 *  hasError: boolean,
 *  message?: string,
 *  addressRemote?: string,
 *  addressType?: number,
 *  portRemote?: number,
 *  rawDataIndex?: number,
 *  vlessVersion?: Uint8Array,
 *  isUDP?: boolean
 * }} An object containing the extracted information or an error message if the buffer is invalid.
 */
function processVlessHeader(
	vlessBuffer,
	userID
) {
	if (vlessBuffer.byteLength < 24) {
		return {
			hasError: true,
			message: 'invalid data',
		};
	}
	// vless version
	const version = vlessBuffer.slice(0, 1);

	let isValidUser = false;
	let isUDP = false;
	const uuids = userID.includes(',') ? userID.split(',') : [userID];

	// if (stringify(vlessBuffer.slice(1, 17)) === userID) {
	// 	isValidUser = true;
	// }
	isValidUser = uuids.some(userUuid => stringify(vlessBuffer.slice(1, 17)) === userUuid.trim()) || uuids.length === 1 && stringify(vlessBuffer.slice(1, 17)) === uuids[0].trim();
	if (!isValidUser) {
		return {
			hasError: true,
			message: 'invalid user',
		};
	}

	//skip opt for now
	const optLength = vlessBuffer.slice(17, 18)[0];

	const command = vlessBuffer.slice(18 + optLength, 18 + optLength + 1)[0];

	if (command === VlessCmd.TCP) {
		isUDP = false;
	} else if (command === VlessCmd.UDP) {
		isUDP = true;
	} else {
		return {
			hasError: true,
			message: `Invalid command type: ${command}, only accepts: ${JSON.stringify(VlessCmd)}`,
		};
	}
	const portIndex = 18 + optLength + 1;
	// port is big-Endian in raw data etc 80 == 0x0050
	const portRemote = (vlessBuffer[portIndex] << 8) | vlessBuffer[portIndex + 1];

	let addressIndex = portIndex + 2;
	const addressBuffer = vlessBuffer.slice(addressIndex, addressIndex + 1);

	const addressType = addressBuffer[0];
	let addressLength = 0;
	let addressValueIndex = addressIndex + 1;
	let addressValue = '';
	switch (addressType) {
		case VlessAddrType.IPv4:
			addressLength = 4;
			addressValue = vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength).join('.');
			break;
		case VlessAddrType.DomainName:
			addressLength = vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)[0];
			addressValueIndex += 1;
			addressValue = new TextDecoder().decode(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			break;
		case VlessAddrType.IPv6:
			addressLength = 16;
			const ipv6Bytes = vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength);
			// 2001:0db8:85a3:0000:0000:8a2e:0370:7334
			const ipv6 = [];
			for (let i = 0; i < 8; i++) {
				const uint16_val = ipv6Bytes[i * 2] << 8 | ipv6Bytes[i * 2 + 1];
				ipv6.push(uint16_val.toString(16));
			}
			addressValue = ipv6.join(':');
			// seems no need add [] for ipv6
			break;
		default:
			return {
				hasError: true,
				message: `Invalid address type: ${addressType}, only accepts: ${JSON.stringify(VlessAddrType)}`,
			};
	}
	if (!addressValue) {
		return {
			hasError: true,
			message: `Empty addressValue!`,
		};
	}

	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		vlessVersion: version,
		isUDP,
	};
}

/**
 * Stream data from the remote destination (any) to the client side (Websocket)
 * @param {ReadableStream} remoteSocketReader from the remote destination
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket to the client side
 * @param {{header: Uint8Array}} vlessResponse Contains information to produce the vless reponse, such as the header.
 * @param {*} log 
 * @returns {Promise<boolean>} has hasIncomingData
 */
async function remoteSocketToWS(remoteSocketReader, webSocket, vlessResponse, log) {
	// This promise fulfills if:
	// 1. There is any incoming data
	// 2. The remoteSocketReader closes without any data
	const toRemotePromise = new Promise((resolve) => {
		let headerSent = false;
		let hasIncomingData = false;

		// Add the response header and monitor if there is any traffic coming from the remote host.
		remoteSocketReader.pipeThrough(new TransformStream({
			start() {
			},
			transform(chunk, controller) {
				// Resolve the promise immediately if we got any data from the remote host.
				hasIncomingData = true;
				resolve(true);

				if (!headerSent) {
					controller.enqueue(joinUint8Array(vlessResponse.header, chunk));
					headerSent = true;
				} else {
					controller.enqueue(chunk);
				}
			},
			flush(controller) {
				log(`Response transformer flushed, hasIncomingData = ${hasIncomingData}`);

				// The connection has been closed, resolve the promise anyway.
				resolve(hasIncomingData);
			}
		}))
			.pipeTo(new WritableStream({
				start() {
				},
				async write(chunk, controller) {
					// remoteChunkCount++;
					if (webSocket.readyState !== WS_READY_STATE_OPEN) {
						controller.error(
							'webSocket.readyState is not open, maybe close'
						);
					}

					// seems no need rate limit this, CF seems fix this??..
					// if (remoteChunkCount > 20000) {
					// 	// cf one package is 4096 byte(4kb),  4096 * 20000 = 80M
					// 	await delay(1);
					// }
					webSocket.send(chunk);
				},
				close() {
					// log(`remoteSocket.readable has been close`);
					// The server dont need to close the websocket first, as it will cause ERR_CONTENT_LENGTH_MISMATCH
					// The client will close the connection anyway.
					// safeCloseWebSocket(webSocket); 
				},
				// abort(reason) {
				// 	console.error(`remoteSocket.readable aborts`, reason);
				// },
			}))
			.catch((error) => {
				console.error(
					`remoteSocketToWS has exception, readyState = ${webSocket.readyState} :`,
					error.stack || error
				);
				safeCloseWebSocket(webSocket);
			});
	});

	return await toRemotePromise;
}

/**
 * Decodes a base64 string into an ArrayBuffer.
 * @param {string} base64Str The base64 string to decode.
 * @returns {{
 *  earlyData: Uint8Array | null,
 *  error: Error | null
 * }} An object containing the decoded ArrayBuffer or an error if the decoding fails.
 */
function base64ToArrayBuffer(base64Str) {
	if (!base64Str) {
		return { error: null };
	}
	try {
		// go use modified Base64 for URL rfc4648 which js atob not support
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		const buffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
		return { earlyData: buffer, error: null };
	} catch (error) {
		return { error };
	}
}


/**
 * Checks if a given string is a valid UUID.
 * Note that this function does not perform a real UUID validation.
 * 
 * @param {string} uuid The string to be validated.
 * @returns {boolean} true if the string is a valid UUID, false otherwise.
 */
function isValidUUID(uuid) {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}


const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

/**
 * Safely closes a WebSocket connection, handling any exceptions that may occur.
 * @param {import("@cloudflare/workers-types").WebSocket} socket The WebSocket connection to close.
 */
function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
			socket.close();
		}
	} catch (error) {
		console.error('safeCloseWebSocket error', error);
	}
}



/**
 * Joins two Uint8Arrays into a single Uint8Array.
 * 
 * @param {Uint8Array} array1 The first Uint8Array to join.
 * @param {Uint8Array} array2 The second Uint8Array to join.
 * @returns {Uint8Array} The merged Uint8Array.
 */
export function joinUint8Array(array1, array2) {
	let result = new Uint8Array(array1.byteLength + array2.byteLength); // Create a new Uint8Array with the combined length of array1 and array2
	result.set(array1); // Copy the values from array1 into the result array
	result.set(array2, array1.byteLength); // Copy the values from array2 into the result array starting at the index of array1's byte length
	return result; // Return the merged Uint8Array
}


// Create an array 'byteToHex' to map byte values to their hexadecimal representation
const byteToHex = [];

// Populate 'byteToHex' with hexadecimal representations for values 0 to 255
for (let i = 0; i < 256; ++i) {
	byteToHex.push((i + 256).toString(16).slice(1));
}

/**
 * Convert a byte array to a UUID string representation.
 * 
 * @param {Uint8Array} arr - The input byte array.
 * @param {number} offset - The starting offset within the byte array (default is 0).
 * @returns {string} The UUID string.
 */
function unsafeStringify(arr, offset = 0) {
	// Construct the UUID string by concatenating hexadecimal representations of bytes
	return (
		byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] +
		byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" +
		byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" +
		byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" +
		byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" +
		byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] +
		byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] +
		byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]
	).toLowerCase();
}

/**
 * Convert a byte array to a valid UUID string representation.
 * Throws an error if the generated string is not a valid UUID.
 * 
 * @param {Uint8Array} arr - The input byte array.
 * @param {number} offset - The starting offset within the byte array (default is 0).
 * @returns {string} The valid UUID string.
 * @throws {TypeError} If the generated string is not a valid UUID.
 */
function stringify(arr, offset = 0) {
	// Generate the UUID string using 'unsafeStringify'
	const uuid = unsafeStringify(arr, offset);

	// Check if the generated UUID string is valid
	if (!isValidUUID(uuid)) {
		throw TypeError("Stringified UUID is invalid");
	}

	return uuid;
}

/**
 * Establishes a SOCKS5 connection with the given socket, username, password, address type, remote address, and remote port.
 *
 * @param {{readable: ReadableStream, writable: {getWriter: () => {write: (data) => void, releaseLock: () => void}}}} socket - The socket to connect to.
 * @param {string} username - The username for authentication (if required).
 * @param {string} password - The password for authentication (if required).
 * @param {number} addressType - The type of address to connect to (1 for IPv4, 2 for domain name, 3 for IPv6).
 * @param {string} addressRemote - The remote address to connect to.
 * @param {number} portRemote - The remote port to connect to.
 * @param {function} log - The logging function.
 * @throws {Error} If there is no response from the server, the server version is wrong, or there are no accepted authentication methods.
 * @throws {Error} If authentication fails.
 * @throws {Error} If the connection fails.
 */
async function socks5Connect(socket, username, password, addressType, addressRemote, portRemote, log) {
	const writer = socket.writable.getWriter();

	// Request head format (Worker -> Socks Server):
	// +----+----------+----------+
	// |VER | NMETHODS | METHODS  |
	// +----+----------+----------+
	// | 1  |    1     | 1 to 255 |
	// +----+----------+----------+

	// https://en.wikipedia.org/wiki/SOCKS#SOCKS5
	// For METHODS:
	// 0x00 NO AUTHENTICATION REQUIRED
	// 0x02 USERNAME/PASSWORD https://datatracker.ietf.org/doc/html/rfc1929
	await writer.write(new Uint8Array([5, 2, 0, 2]));

	const reader = socket.readable.getReader();
	const encoder = new TextEncoder();
	let res = (await reader.read()).value;
	if (!res) {
		throw new Error(`No response from the server`);
	}

	// Response format (Socks Server -> Worker):
	// +----+--------+
	// |VER | METHOD |
	// +----+--------+
	// | 1  |   1    |
	// +----+--------+
	if (res[0] !== 0x05) {
		throw new Error(`Wrong server version: ${res[0]} expected: 5`);
	}
	if (res[1] === 0xff) {
		throw new Error("No accepted authentication methods");
	}

	// Perform authentication if requested by the server
	if (res[1] === 0x02) {
		log("Socks5: Server asks for authentication");
		if (!username || !password) {
			throw new Error("Please provide username/password");
		}
		// +----+------+----------+------+----------+
		// |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
		// +----+------+----------+------+----------+
		// | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
		// +----+------+----------+------+----------+
		const authRequest = new Uint8Array([
			1,
			username.length,
			...encoder.encode(username),
			password.length,
			...encoder.encode(password)
		]);
		await writer.write(authRequest);
		res = (await reader.read()).value;
		// expected 0x0100
		if (res[0] !== 0x01 || res[1] !== 0x00) {
			throw new Error("Authentication failed");
		}
	}

	// Request data format (Worker -> Socks Server):
	// +----+-----+-------+------+----------+----------+
	// |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
	// +----+-----+-------+------+----------+----------+
	// | 1  |  1  | X'00' |  1   | Variable |    2     |
	// +----+-----+-------+------+----------+----------+
	// ATYP: address type of following address
	// 0x01: IPv4 address
	// 0x03: Domain name
	// 0x04: IPv6 address
	// DST.ADDR: desired destination address
	// DST.PORT: desired destination port in network octet order

	// addressType
	// 1--> ipv4  addressLength =4
	// 2--> domain name
	// 3--> ipv6  addressLength =16
	let DSTADDR;	// DSTADDR = ATYP + DST.ADDR
	switch (addressType) {
		case 1:
			DSTADDR = new Uint8Array(
				[1, ...addressRemote.split('.').map(Number)]
			);
			break;
		case 2:
			DSTADDR = new Uint8Array(
				[3, addressRemote.length, ...encoder.encode(addressRemote)]
			);
			break;
		case 3:
			DSTADDR = new Uint8Array(
				[4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]
			);
			break;
		default:
			log(`invild  addressType is ${addressType}`);
			return;
	}
	const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
	await writer.write(socksRequest);
	log('Socks5: Sent request');

	res = (await reader.read()).value;
	// Response format (Socks Server -> Worker):
	//  +----+-----+-------+------+----------+----------+
	// |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
	// +----+-----+-------+------+----------+----------+
	// | 1  |  1  | X'00' |  1   | Variable |    2     |
	// +----+-----+-------+------+----------+----------+
	if (res[1] === 0x00) {
		log("Socks5: Connection opened");
	} else {
		throw new Error("Connection failed");
	}
	writer.releaseLock();
	reader.releaseLock();
}

/**
 * Parses a SOCKS5 address string into its components.
 * @param {string} address The SOCKS5 address string in the format "hostname:port" or "username:password@hostname:port".
 * @returns {{
 *  username: string | undefined,
 *  password: string | undefined,
 *  hostname: string,
 *  port: number
 * }} An object containing the parsed components of the SOCKS5 address string.
 * @throws {Error} If the address string is in an invalid format.
 */

function socks5AddressParser(address) {
	let [latter, former] = address.split("@").reverse();
	let username, password, hostname, port;
	if (former) {
		const formers = former.split(":");
		if (formers.length !== 2) {
			throw new Error('Invalid SOCKS address format');
		}
		[username, password] = formers;
	}
	const latters = latter.split(":");
	port = Number(latters.pop());
	if (isNaN(port)) {
		throw new Error('Invalid SOCKS address format');
	}
	hostname = latters.join(":");
	const regex = /^\[.*\]$/;
	if (hostname.includes(":") && !regex.test(hostname)) {
		throw new Error('Invalid SOCKS address format');
	}
	return {
		username,
		password,
		hostname,
		port,
	}
}

const VlessCmd = {
	TCP: 1,
	UDP: 2,
	MUX: 3,
};

const VlessAddrType = {
	IPv4: 1,		// 4-bytes
	DomainName: 2,	// The first byte indicates the length of the following domain name
	IPv6: 3,		// 16-bytes
};

/**
 * Generate a vless request header.
 * @param {number} command - The command to execute (see VlessCmd).
 * @param {number} destType - The type of destination address (see VlessAddrType).
 * @param {string} destAddr - The destination address.
 * @param {number} destPort - The destination port.
 * @param {string} uuid - The UUID of the request.
 * @returns {Uint8Array} - The vless request header as a Uint8Array.
 * @throws {Error} - If the address type is unknown.
 */
function makeVlessReqHeader(command, destType, destAddr, destPort, uuid) {
	/** @type {number} */
	let addressFieldLength;
	/** @type {Uint8Array | undefined} */
	let addressEncoded;
	switch (destType) {
		case VlessAddrType.IPv4:
			addressFieldLength = 4;
			break;
		case VlessAddrType.DomainName:
			addressEncoded = new TextEncoder().encode(destAddr);
			addressFieldLength = addressEncoded.length + 1;
			break;
		case VlessAddrType.IPv6:
			addressFieldLength = 16;
			break;
		default:
			throw new Error(`Unknown address type: ${destType}`);
	}

	const uuidString = uuid.replace(/-/g, '');
	const uuidOffset = 1;
	const vlessHeader = new Uint8Array(22 + addressFieldLength);

	// Protocol Version = 0
	vlessHeader[0] = 0x00;

	for (let i = 0; i < uuidString.length; i += 2) {
		vlessHeader[uuidOffset + i / 2] = parseInt(uuidString.substr(i, 2), 16);
	}

	// Additional Information Length M = 0
	vlessHeader[17] = 0x00;

	// Instruction
	vlessHeader[18] = command;

	// Port, 2-byte big-endian
	vlessHeader[19] = destPort >> 8;
	vlessHeader[20] = destPort & 0xFF;

	// Address Type
	// 1--> ipv4  addressLength =4
	// 2--> domain name addressLength=addressBuffer[1]
	// 3--> ipv6  addressLength =16
	vlessHeader[21] = destType;

	// Address
	switch (destType) {
		case VlessAddrType.IPv4:
			const octetsIPv4 = destAddr.split('.');
			for (let i = 0; i < 4; i++) {
				vlessHeader[22 + i] = parseInt(octetsIPv4[i]);
			}
			break;
		case VlessAddrType.DomainName:
			vlessHeader[22] = addressEncoded.length;
			vlessHeader.set(addressEncoded, 23);
			break;
		case VlessAddrType.IPv6:
			const groupsIPv6 = ipv6.split(':');
			for (let i = 0; i < 8; i++) {
				const hexGroup = parseInt(groupsIPv6[i], 16);
				vlessHeader[i * 2 + 22] = hexGroup >> 8;
				vlessHeader[i * 2 + 23] = hexGroup & 0xFF;
			}
			break;
		default:
			throw new Error(`Unknown address type: ${destType}`);
	}

	return vlessHeader;
}

/**
 * Checks if the provided VLESS configuration is valid for the given address and stream settings.
 * @param {string} address - The address to check against.
 * @param {Object} streamSettings - The stream settings to check.
 * @throws {Error} If the outbound stream method is not 'ws'.
 * @throws {Error} If the security layer is not 'none' or 'tls'.
 * @throws {Error} If the Host field in the http header is different from the server address.
 * @throws {Error} If the SNI is different from the server address.
 */
function checkVlessConfig(address, streamSettings) {
	if (streamSettings.network !== 'ws') {
		throw new Error(`Unsupported outbound stream method: ${streamSettings.network}, has to be ws (Websocket)`);
	}

	if (streamSettings.security !== 'tls' && streamSettings.security !== 'none') {
		throw new Error(`Usupported security layer: ${streamSettings.network}, has to be none or tls.`);
	}

	if (streamSettings.wsSettings && streamSettings.wsSettings.headers && streamSettings.wsSettings.headers.Host !== address) {
		throw new Error(`The Host field in the http header is different from the server address, this is unsupported due to Cloudflare API restrictions`);
	}

	if (streamSettings.tlsSettings && streamSettings.tlsSettings.serverName !== address) {
		throw new Error(`The SNI is different from the server address, this is unsupported due to Cloudflare API restrictions`);
	}
}


/**
 * Parses a VLESS URL string into its components.
 * @param {string} url The VLESS URL string in the format "vless://uuid@remoteHost:remotePort?queryParams#descriptiveText".
 * @returns {{
 *  protocol: string,
 *  uuid: string,
 *  remoteHost: string,
 *  remotePort: number,
 *  descriptiveText: string,
 *  queryParams: Object<string, string>
 * }} An object containing the parsed components of the VLESS URL string.
 * @throws {Error} If the URL string is in an invalid format.
 */
function parseVlessString(url) {
	const regex = /^(.+):\/\/(.+?)@(.+?):(\d+)(\?[^#]*)?(#.*)?$/;
	const match = url.match(regex);

	if (!match) {
		throw new Error('Invalid URL format');
	}

	const [, protocol, uuid, remoteHost, remotePort, query, descriptiveText] = match;

	const json = {
		protocol,
		uuid,
		remoteHost,
		remotePort: parseInt(remotePort),
		descriptiveText: descriptiveText ? descriptiveText.substring(1) : '',
		queryParams: {}
	};

	if (query) {
		const queryFields = query.substring(1).split('&');
		queryFields.forEach(field => {
			const [key, value] = field.split('=');
			json.queryParams[key] = value;
		});
	}

	return json;
}


/**
 * Generates a VLESS configuration for a given set of globalConfig.userID and hostName.
 * @param {string} hostName - The hostname to use in the configuration.
 * @param {string} proxyIP - The IP address of the proxy to use in the configuration.
 * @param {string} commonUrlPart - The common URL part to use in the configuration.
 * @returns {string} - The generated HTML string containing the VLESS configuration.
 */
function getVLESSConfig(hostName) {
	const commonUrlPart = `:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
	const separator = "---------------------------------------------------------------";
	const hashSeparator = "################################################################";

	// Split the globalConfig.userID into an array
	let userIDArray = globalConfig.userID.split(',');

	// Prepare output array
	let output = [];
	let header = [];

	header.push(`\n<p align="center">
	<img src="https://cloudflare-ipfs.com/ipfs/bafybeigd6i5aavwpr6wvnwuyayklq3omonggta4x2q7kpmgafj357nkcky" alt="图片描述" style="margin-bottom: -50px;">
`);
	header.push(`\n<b style=" font-size: 15px;" >Welcome! This function generates configuration for VLESS protocol. If you found this useful, please check our GitHub project for more:</b>\n`);
	header.push(`<b style=" font-size: 15px;" >欢迎！这是生成 VLESS 协议的配置。如果您发现这个项目很好用，请查看我们的 GitHub 项目给我一个star：</b>\n`);
	header.push(`\n<a href="https://github.com/3Kmfi6HP/EDtunnel" target="_blank">EDtunnel - https://github.com/3Kmfi6HP/EDtunnel</a>\n`);
	header.push(`\n<iframe src="https://ghbtns.com/github-btn.html?user=USERNAME&repo=REPOSITORY&type=star&count=true&size=large" frameborder="0" scrolling="0" width="170" height="30" title="GitHub"></iframe>\n\n`.replace(/USERNAME/g, "3Kmfi6HP").replace(/REPOSITORY/g, "EDtunnel"));
	header.push(`<a href="//${hostName}/sub/${userIDArray[0]}" target="_blank">VLESS 节点订阅连接</a>\n<a href="https://subconverter.do.xn--b6gac.eu.org/sub?target=clash&url=https://${hostName}/sub/${userIDArray[0]}?format=clash&insert=false&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true" target="_blank">Clash 节点订阅连接</a></p>\n`);
	header.push(``);

	// Generate output string for each userID
	userIDArray.forEach((userID) => {
		const vlessMain = `vless://${userID}@${hostName}${commonUrlPart}`;
		const vlessSec = `vless://${userID}@${globalConfig.proxyIP}${commonUrlPart}`;
		output.push(`UUID: ${userID}`);
		output.push(`${hashSeparator}\nv2ray default ip\n${separator}\n${vlessMain}\n${separator}`);
		output.push(`${hashSeparator}\nv2ray with best ip\n${separator}\n${vlessSec}\n${separator}`);
	});
	output.push(`${hashSeparator}\n# Clash Proxy Provider 配置格式(configuration format)\nproxy-groups:\n  - name: UseProvider\n	type: select\n	use:\n	  - provider1\n	proxies:\n	  - Proxy\n	  - DIRECT\nproxy-providers:\n  provider1:\n	type: http\n	url: https://${hostName}/sub/${userIDArray[0]}?format=clash\n	interval: 3600\n	path: ./provider1.yaml\n	health-check:\n	  enable: true\n	  interval: 600\n	  # lazy: true\n	  url: http://www.gstatic.com/generate_204\n\n${hashSeparator}`);

	// HTML Head with CSS
	const htmlHead = `
    <head>
        <title>EDtunnel: VLESS configuration</title>
        <meta name="description" content="This is a tool for generating VLESS protocol configurations. Give us a star on GitHub https://github.com/3Kmfi6HP/EDtunnel if you found it useful!">
		<meta name="keywords" content="EDtunnel, cloudflare pages, cloudflare worker, severless">
        <meta name="viewport" content="width=device-width, initial-scale=1">
		<meta property="og:site_name" content="EDtunnel: VLESS configuration" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="EDtunnel - VLESS configuration and subscribe output" />
        <meta property="og:description" content="Use cloudflare pages and worker severless to implement vless protocol" />
        <meta property="og:url" content="https://${hostName}/" />
        <meta property="og:image" content="https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(`vless://${globalConfig.userID.split(',')[0]}@${hostName}${commonUrlPart}`)}" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="EDtunnel - VLESS configuration and subscribe output" />
        <meta name="twitter:description" content="Use cloudflare pages and worker severless to implement vless protocol" />
        <meta name="twitter:url" content="https://${hostName}/" />
        <meta name="twitter:image" content="https://cloudflare-ipfs.com/ipfs/bafybeigd6i5aavwpr6wvnwuyayklq3omonggta4x2q7kpmgafj357nkcky" />
        <meta property="og:image:width" content="1500" />
        <meta property="og:image:height" content="1500" />

        <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f0f0f0;
            color: #333;
            padding: 10px;
        }

        a {
            color: #1a0dab;
            text-decoration: none;
        }
		img {
			max-width: 100%;
			height: auto;
		}
		
        pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            background-color: #fff;
            border: 1px solid #ddd;
            padding: 15px;
            margin: 10px 0;
        }
		/* Dark mode */
        @media (prefers-color-scheme: dark) {
            body {
                background-color: #333;
                color: #f0f0f0;
            }

            a {
                color: #9db4ff;
            }

            pre {
                background-color: #282a36;
                border-color: #6272a4;
            }
        }
        </style>
    </head>
    `;

	// Join output with newlines, wrap inside <html> and <body>
	return `
    <html>
    ${htmlHead}
    <body>
    <pre style="
    background-color: transparent;
    border: none;
">${header.join('')}</pre><pre>${output.join('\n')}</pre>
    </body>
</html>`;
}


/**
 * Generates a VLESS subscription configuration for a given set of userIDs and hostName.
 * @param {string} userID_Path - A comma-separated string of userIDs or a single userID.
 * @param {string} hostName - The hostname to use in the configuration.
 * @returns {string} - The generated string containing the VLESS subscription configuration.
 */

function createVLESSSub(userID_Path, hostName) {
	let portArray_http = [80, 8080, 8880, 2052, 2086, 2095, 2082];
	let portArray_https = [443, 8443, 2053, 2096, 2087, 2083];

	// Split the userIDs into an array
	let userIDArray = userID_Path.includes(',') ? userID_Path.split(',') : [userID_Path];

	// Prepare output array
	let output = [];

	// Generate output string for each userID
	userIDArray.forEach((userID) => {
		// Check if the hostName is a Cloudflare Pages domain, if not, generate HTTP configurations
		// reasons: pages.dev not support http only https
		if (!hostName.includes('pages.dev')) {
			// Iterate over all ports for http
			portArray_http.forEach((port) => {
				const commonUrlPart_http = `:${port}?encryption=none&security=none&fp=random&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}-HTTP`;
				const vlessMainHttp = `vless://${userID}@${hostName}${commonUrlPart_http}`;

				// For each proxy IP, generate a VLESS configuration and add to output
				proxyIPs.forEach((proxyIP) => {
					const vlessSecHttp = `vless://${userID}@${proxyIP}${commonUrlPart_http}-${proxyIP}-EDtunnel`;
					output.push(`${vlessMainHttp}`);
					output.push(`${vlessSecHttp}`);
				});
			});
		}
		// Iterate over all ports for https
		portArray_https.forEach((port) => {
			const commonUrlPart_https = `:${port}?encryption=none&security=tls&sni=${hostName}&fp=random&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}-HTTPS`;
			const vlessMainHttps = `vless://${userID}@${hostName}${commonUrlPart_https}`;

			// For each proxy IP, generate a VLESS configuration and add to output
			proxyIPs.forEach((proxyIP) => {
				const vlessSecHttps = `vless://${userID}@${proxyIP}${commonUrlPart_https}-${proxyIP}-EDtunnel`;
				output.push(`${vlessMainHttps}`);
				output.push(`${vlessSecHttps}`);
			});
		});
	});

	// Join output with newlines
	return output.join('\n');
}

