import {SolanaBtcRelay} from "crosslightning-solana/dist";
import {BitcoindBlock, BitcoindRpc} from "btcrelay-bitcoind/dist";
import {AnchorProvider, Wallet} from "@coral-xyz/anchor";
import {Connection, Keypair} from "@solana/web3.js";
import * as nodemailer from "nodemailer";

import * as dotenv from "dotenv";
dotenv.config();

let bitcoinRpc: BitcoindRpc;
let btcRelay: SolanaBtcRelay<BitcoindBlock>;

const mailCooldown = 1*60*60*1000;
const maxHeightDifference = 3;

let lastMailSent = 0;

const transporter = nodemailer.createTransport({
    service: process.env.MAIL_SERVICE,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

async function sendMail(msg: string) {

    console.log(msg);

    if(Date.now()-lastMailSent<mailCooldown) return;

    const mailOptions = {
        from: process.env.MAIL_USER,
        to: process.env.MAIL_TO,
        subject: 'Solana watchdog ERROR',
        text: msg
    };

    await new Promise(function (resolve, reject) {
        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                reject(error);
            } else {
                resolve(info);
            }
        });
    });

    lastMailSent = Date.now();

}

async function runCheck() {

    let retries = 3;

    while(retries>0) {
        try {

            const solanaTipData = await btcRelay.getTipData();
            const btcTipHeight = await bitcoinRpc.getTipHeight();

            console.log("Running check, solana tip height: "+solanaTipData.blockheight+" btc tip height: "+btcTipHeight);

            const difference = btcTipHeight-solanaTipData.blockheight;

            if(Math.abs(difference)>maxHeightDifference) {
                await sendMail("Solana btc relay blockheight difference too high ("+difference+")! BTCRelay: "+solanaTipData.blockheight+" Bitcoin: "+btcTipHeight);
                return;
            }

            let error = null;
            const result: boolean | void = await bitcoinRpc.isInMainChain(solanaTipData.blockhash).catch(e => {
                error = e;
                console.error(e)
            });

            console.log("Solana tip is in main chain: ", result);

            if(error!=null) {
                await sendMail("Solana btc relay error getting tip header from bitcoind, blockhash: "+solanaTipData.blockhash);
                return;
            }

            if(!result) {
                await sendMail("Solana btc relay tip in main chain, blockhash: "+solanaTipData.blockhash);
                return;
            }

            return;

        } catch (e) {

            console.error(e);
            if(!e.toString().startsWith("FetchError")) {
                await sendMail("Solana watchdog error: "+e.toString());
                return;
            }

        }
        retries--;
        if(retries>0) await new Promise(resolve => setTimeout(resolve, 10000));
    }
}


function main() {

    const _signer = Keypair.generate();

    const connection = new Connection(process.env.SOL_RPC_URL, "processed");
    const AnchorSigner: (AnchorProvider & {signer: Keypair}) = new AnchorProvider(connection, new Wallet(_signer), {
        preflightCommitment: "processed"
    }) as any;

    bitcoinRpc = new BitcoindRpc(
        process.env.BTC_PROTOCOL,
        process.env.BTC_RPC_USERNAME,
        process.env.BTC_RPC_PASSWORD,
        process.env.BTC_NODE_HOST,
        parseInt(process.env.BTC_PORT)
    );
    btcRelay = new SolanaBtcRelay<BitcoindBlock>(AnchorSigner, bitcoinRpc, process.env.BTC_RELAY_CONTRACT_ADDRESS);

    runCheck();
    setInterval(runCheck, 10*60*1000);

}

main();