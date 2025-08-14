import * as dotenv from "dotenv";
import {Connection} from "@solana/web3.js";
import {BitcoindBlock, BitcoindRpc} from "@atomiqlabs/btc-bitcoind";
import {RpcProvider} from "starknet";

import {SolanaBtcRelay, SolanaChainInterface, SolanaChainType} from "@atomiqlabs/chain-solana";
import {StarknetBtcRelay, StarknetChainInterface, StarknetChainType} from "@atomiqlabs/chain-starknet";
import {BtcRelayWatchdog} from "./BtcRelayWatchdog";
import {BitcoinNetwork} from "@atomiqlabs/base";

dotenv.config();

async function main() {

    const bitcoinRpc = new BitcoindRpc(
        process.env.BTC_PROTOCOL,
        process.env.BTC_RPC_USERNAME,
        process.env.BTC_RPC_PASSWORD,
        process.env.BTC_NODE_HOST,
        parseInt(process.env.BTC_PORT)
    );

    const watchdogs: BtcRelayWatchdog<any>[] = [];

    if(process.env.SOL_RPC_URL!=null) {
        const connection = new Connection(process.env.SOL_RPC_URL, "processed");
        const chainInterface = new SolanaChainInterface(connection);
        const solBtcRelay = new SolanaBtcRelay<BitcoindBlock>(chainInterface, bitcoinRpc, process.env.BTC_RELAY_CONTRACT_ADDRESS);
        watchdogs.push(new BtcRelayWatchdog<SolanaChainType>("SOLANA", bitcoinRpc, solBtcRelay));
    }

    if(process.env.STARKNET_RPC_URL!=null) {
        const provider = new RpcProvider({nodeUrl: process.env.STARKNET_RPC_URL});
        const chainInterface = new StarknetChainInterface(await provider.getChainId(), provider);
        const starknetBtcRelay = new StarknetBtcRelay(chainInterface, bitcoinRpc, BitcoinNetwork.MAINNET, process.env.STARKNET_BTC_RELAY_CONTRACT_ADDRESS);
        watchdogs.push(new BtcRelayWatchdog<StarknetChainType>("STARKNET", bitcoinRpc, starknetBtcRelay));
    }

    if(watchdogs.length===0) throw new Error("No chain specified!");

    watchdogs.forEach(val => val.runCheck().catch(e => console.error(val.chainId+" error: ", e)));
    setInterval(() => {
        watchdogs.forEach(val => val.runCheck().catch(e => console.error(val.chainId+" error: ", e)));
    }, 10*60*1000);

}

main();
