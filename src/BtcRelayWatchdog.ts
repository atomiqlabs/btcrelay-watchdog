import {BitcoinRpc, ChainType} from "@atomiqlabs/base";
import * as nodemailer from "nodemailer";

const mailCooldown = 1*60*60*1000;
const maxHeightDifference = 3;

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

export class BtcRelayWatchdog<T extends ChainType> {

    readonly chainId: T["ChainId"];
    readonly bitcoinRpc: BitcoinRpc<any>;
    readonly btcRelay: T["BtcRelay"];
    lastMailSent: number = 0;

    constructor(chainId: T["ChainId"], bitcoinRpc: BitcoinRpc<any>, btcRelay: T["BtcRelay"]) {
        this.bitcoinRpc = bitcoinRpc;
        this.btcRelay = btcRelay;
        this.chainId = chainId;
    }

    async sendMail(msg: string) {

        console.log(msg);

        if(Date.now()-this.lastMailSent<mailCooldown) return;

        const mailOptions = {
            from: process.env.MAIL_USER,
            to: process.env.MAIL_TO,
            subject: this.chainId+' watchdog ERROR',
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

        this.lastMailSent = Date.now();

    }

    async runCheck() {

        let retries = 3;

        while(retries>0) {
            try {

                const scTipData = await this.btcRelay.getTipData();
                const btcTipHeight = await this.bitcoinRpc.getTipHeight();

                console.log("Running check, "+this.chainId+" tip height: "+scTipData.blockheight+" btc tip height: "+btcTipHeight);

                const difference = btcTipHeight-scTipData.blockheight;

                if(Math.abs(difference)>maxHeightDifference) {
                    await this.sendMail(this.chainId+" btc relay blockheight difference too high ("+difference+")! BTCRelay: "+scTipData.blockheight+" Bitcoin: "+btcTipHeight);
                    return;
                }

                let error = null;
                const result: boolean | void = await this.bitcoinRpc.isInMainChain(scTipData.blockhash).catch(e => {
                    error = e;
                    console.error(e)
                });

                console.log(this.chainId+" tip is in main chain: ", result);

                if(error!=null) {
                    await this.sendMail(this.chainId+" btc relay error getting tip header from bitcoind, blockhash: "+scTipData.blockhash);
                    return;
                }

                if(!result) {
                    await this.sendMail(this.chainId+" btc relay tip in main chain, blockhash: "+scTipData.blockhash);
                    return;
                }

                return;

            } catch (e) {

                console.error(e);
                if(!e.toString().startsWith("FetchError")) {
                    await this.sendMail(this.chainId+" watchdog error: "+e.toString());
                    return;
                }

            }
            retries--;
            if(retries>0) await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }


}
