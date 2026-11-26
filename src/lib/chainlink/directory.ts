import type { StreamsNetwork, SupportedTicker } from "./config";

// chainlink's published stream directory for the supported tickers, copied from
// https://docs.chain.link/data-streams/rwa-streams (24/5 us equities, "-production"
// entries) on 2026-11-26. every stream here is rwa advanced (v11).
//
// this is a cross-check, not the source of truth: stream discovery asks chainlink's api
// which streams the account can actually read (listFeeds) and refuses any stream whose
// id or name disagrees with this table. a ticker that discovery can't confirm is unavailable.

export type StreamSession = "regular" | "extended" | "overnight";
export interface DirectoryStream { name: string; streamId: `0x${string}`; status: string }

export const CHAINLINK_DIRECTORY: Record<StreamsNetwork, Record<SupportedTicker, Record<StreamSession, DirectoryStream>>> = {
  testnet: {
    NVDA: {
      regular: { name: "NVDA/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b1d444945231e44dd47736c6abe288b10cb1b53941c7c68012fbdd2b1755c", status: "testing" },
      extended: { name: "NVDA/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000bf689e4aa5c006c89c207eb155ae99184e433a518753eb745cc552391a743", status: "testing" },
      overnight: { name: "NVDA/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b99b86a91cc317e2db8370f1466844dd9460cb51c3bf12fcc8d19d53d97bb", status: "testing" },
    },
    AAPL: {
      regular: { name: "AAPL/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b61d6dec069be40efc5f21f0345142a827f42966a07fa4743773383a8dd7b", status: "testing" },
      extended: { name: "AAPL/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000bbff670f86a195158a347cb04693bdc7d475ab43c645448c8835268b1d099", status: "testing" },
      overnight: { name: "AAPL/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000bc10943a8c16f49ccec18764dfbed0c8d367503caf3a6e8af2087e79e81b7", status: "testing" },
    },
    TSLA: {
      regular: { name: "TSLA/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b08f5e1a8c355e9982cea5707cf7b60be8ef91c42bb8022fd63f1bd71f6ab", status: "testing" },
      extended: { name: "TSLA/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b4642144cb2e2f0e38ba57cc15a6549fd1522da1e7560f3d9e198b23fbe50", status: "testing" },
      overnight: { name: "TSLA/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b2729962eb0c3e39d0778279004b52cdce9bc511a79c31c7f14516b2e3652", status: "testing" },
    },
    MSFT: {
      regular: { name: "MSFT/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b032fac53b731d7e9e8b0767151984f97ef151900a78be2fcc9713455ffc5", status: "testing" },
      extended: { name: "MSFT/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b48add0681d9ca52424c1eccda5bcbf038eb85db3e67fe9b2931f1c2fd97a", status: "testing" },
      overnight: { name: "MSFT/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000bd230c2a3f549aad1288360bcd329e8b5591ae205b31595d009bb122dcf8e", status: "testing" },
    },
    AMZN: {
      regular: { name: "AMZN/USD-Streams-RegularHoursEquityPrice", streamId: "0x000babb1ff3f6920ebb15da8439f03f3b8669cc3f4c6b69594289e2e6af485ef", status: "testing" },
      extended: { name: "AMZN/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b3a32200a6ca3e3c55a7de7ba690c86a071c58167f34778ab0cbf1d37fdc6", status: "testing" },
      overnight: { name: "AMZN/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b042e894fb4404a2384854e4d678a85f943f2b83b25b2d837a426218dfcb3", status: "testing" },
    },
    GOOGL: {
      regular: { name: "GOOGL/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b62925feea3a68e02358e2cdd0edade49ba782cd7ba605bd834cdfd5e04af", status: "testing" },
      extended: { name: "GOOGL/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b38cecfeca43e3b5cce05b2e25abebad62de192727e5d6fae47846ff90e0a", status: "testing" },
      overnight: { name: "GOOGL/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b27e8a01b15d1151b1dec1f33702d3d4966414b9b750bbb261f75a2c29bb4", status: "testing" },
    },
    META: {
      regular: { name: "META/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b7a8a64a03bee8c58f32e24bef3cad363bd33cf5384f485d301f0c8cf2fc0", status: "testing" },
      extended: { name: "META/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000bb3991a740a35cafa5cdb2f9bd9372d575ec137a99543e943caa4a6b9c4bc", status: "testing" },
      overnight: { name: "META/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b2ef7c9d5369d8494a1000933a6815fd79dead95acb8ae07ce4f10127f926", status: "testing" },
    },
  },
  mainnet: {
    NVDA: {
      regular: { name: "NVDA/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9", status: "live" },
      extended: { name: "NVDA/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000bb043961643d051393c085a4dd0cded6f67b4b71e47e9dcec739b7b3e2145", status: "live" },
      overnight: { name: "NVDA/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b47988e89f3e63e1d679c84b774e6c38bb9929ad9de6e5e56d657a80388a9", status: "live" },
    },
    AAPL: {
      regular: { name: "AAPL/USD-Streams-RegularHoursEquityPrice", streamId: "0x000bbd87a23775b4c11092ae9a1fc7b3393636ae1dbb9f1ef460f845c0f4cff1", status: "live" },
      extended: { name: "AAPL/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b8b9394931d376dbfd988ab3e459b1954ca10880d6a2ec706cd2573910b5b", status: "live" },
      overnight: { name: "AAPL/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b313c8a4997a3bc871130415ffeb42cd37b79cf68c11478780650cc553c0b", status: "live" },
    },
    TSLA: {
      regular: { name: "TSLA/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b2dbed1640ead18d37338b75e4755630a900649261baf4ed79d9a749be13d", status: "live" },
      extended: { name: "TSLA/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b9e87f3f1ac8e590e47cce07a3e964d94f2abd5692b2f92f1dbab79874b07", status: "live" },
      overnight: { name: "TSLA/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b67554457bf6c7e70d4d599d9634888fc8d79145c534ddd77ba1dae840107", status: "live" },
    },
    MSFT: {
      regular: { name: "MSFT/USD-Streams-RegularHoursEquityPrice", streamId: "0x000bc4bcae3f338a2496aeee763156b999465bda826a3ccc94987d32a98212ab", status: "live" },
      extended: { name: "MSFT/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b473fc515c571af8f74d78f2db17af4dbfe1e4f7154ec734fa017d9969a9e", status: "live" },
      overnight: { name: "MSFT/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000bcff8ee20831a5d4a5be560e193556ce0c7d3ec1d38277c0bb78d84332d6a", status: "live" },
    },
    AMZN: {
      regular: { name: "AMZN/USD-Streams-RegularHoursEquityPrice", streamId: "0x000bfb41659084e9ea0ea672b12b7878d88511dcac813d82435da65df946f65c", status: "live" },
      extended: { name: "AMZN/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b2544d6c3acec0820a38daff371b844cc2415f57f9648a2238a0b3076e868", status: "live" },
      overnight: { name: "AMZN/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b9bbaa779d3bf05d3f2a91942a3bc0a5ad36f80b1499f77dc63a1a4056693", status: "live" },
    },
    GOOGL: {
      regular: { name: "GOOGL/USD-Streams-RegularHoursEquityPrice", streamId: "0x000b1a2aa24db17599e5003a09bcd5e2a15ef66f79c2dca4dde108ab923b1e97", status: "live" },
      extended: { name: "GOOGL/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000ba0be5e4c3746e3ebccec37362d9640ae6e9fee07bbb95ebdfd37d0220355", status: "live" },
      overnight: { name: "GOOGL/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000b2630095c8e9f31bde1f89f6b99106f7740649b7a9bde504ad6f8cf52cfbc", status: "live" },
    },
    META: {
      regular: { name: "META/USD-Streams-RegularHoursEquityPrice", streamId: "0x000bc63e601958daafb805b1eecc3972a0ad231e8c08c0432961b7b5c3251166", status: "live" },
      extended: { name: "META/USD-Streams-ExtendedHoursEquityPrice", streamId: "0x000b2f98113576782a2bb2cecbbfd034d7c949d8457ff81dfa68b6b2927dc2ee", status: "live" },
      overnight: { name: "META/USD-Streams-OvernightHoursEquityPrice", streamId: "0x000bd63dc623dc102eeed0fe61ae7a3e13a28961df9a79912147f0234706f7ef", status: "live" },
    },
  },
};
