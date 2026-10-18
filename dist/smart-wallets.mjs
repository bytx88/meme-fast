// Manually supplied HOOKED research group; not an independently verified label.
export const SMART_TEST_TOKEN='C1mBfBoDkwWfd6uTFZp62ARHLjeVp3bDpCDMfMZtPngE';
export const SMART_WALLETS=Object.freeze([
  '4CPQqg2GeUiyykB5Vz5VHMSDbGa6ztjk5RcpdMdm3Hu1',
  '9CXqAEnMKRAE14QiKhSXA9PQPmHf4suCHDtDkFTpUjw4',
  '6CgsbsC1nAchgQ1d1tZgDSWiVuUPjj9rnkU76YeypAHe',
  '5bFi2MNTzcSwPg3Hy5rb5db6Nr9g5qtNwJnTfE4Kb9iS',
  'H6PEtpaDddtPEQjvGwEq5y7nF7WpNsTNy73m5h97oTye',
  '8ddc12hR2ePg4UkkWcecd9ShcNJyHrkBpLDjd8Yjn4GG',
  'FXBA4QqvkWTajCrApU8MF8h7GjrySZTLoUqYCFkhPDoa',
  '9e6ZQpCcKhejmnXwhVPVKejv7B9tCN3iTWWy4bNtX9ut',
  'J53jf6fUKNnmrPp62V1vakdoGV4eviiE1UMPYqAPJq1t'
]);
const addresses=new Set(SMART_WALLETS);
export function hasSmartGroup(tokens){
  return tokens.length===1&&tokens[0].network==='solana'&&tokens[0].address===SMART_TEST_TOKEN;
}
export function smartWalletTrades(trades){
  // Solana addresses are case-sensitive. Match the attributed sender exactly.
  return trades.filter(trade=>trade.network==='solana'&&trade.tokenKey===`solana:${SMART_TEST_TOKEN}`&&addresses.has(trade.wallet));
}
