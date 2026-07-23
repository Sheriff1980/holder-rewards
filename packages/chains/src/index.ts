export type ChainFamily = "evm" | "solana" | "mock";

export type BuiltinChainId =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "apechain"
  | "solana"
  | "mock";

export type ChainId = BuiltinChainId | (string & {});

export type ChainDefinition = {
  id: ChainId;
  family: ChainFamily;
  name: string;
  chainReference: string;
  nativeCurrencySymbol: string;
  defaultRpcUrl?: string;
  explorerUrl?: string;
  builtin: boolean;
};

export const BUILTIN_CHAINS: readonly ChainDefinition[] = [
  {
    id: "ethereum",
    family: "evm",
    name: "Ethereum",
    chainReference: "1",
    nativeCurrencySymbol: "ETH",
    defaultRpcUrl: "https://cloudflare-eth.com/v1/mainnet",
    explorerUrl: "https://etherscan.io",
    builtin: true
  },
  {
    id: "base",
    family: "evm",
    name: "Base",
    chainReference: "8453",
    nativeCurrencySymbol: "ETH",
    defaultRpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    builtin: true
  },
  {
    id: "polygon",
    family: "evm",
    name: "Polygon",
    chainReference: "137",
    nativeCurrencySymbol: "POL",
    defaultRpcUrl: "https://polygon.drpc.org",
    explorerUrl: "https://polygonscan.com",
    builtin: true
  },
  {
    id: "arbitrum",
    family: "evm",
    name: "Arbitrum One",
    chainReference: "42161",
    nativeCurrencySymbol: "ETH",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    builtin: true
  },
  {
    id: "apechain",
    family: "evm",
    name: "ApeChain",
    chainReference: "33139",
    nativeCurrencySymbol: "APE",
    defaultRpcUrl: "https://apechain.calderachain.xyz/http",
    explorerUrl: "https://apechain.calderaexplorer.xyz",
    builtin: true
  },
  {
    id: "solana",
    family: "solana",
    name: "Solana",
    chainReference: "mainnet-beta",
    nativeCurrencySymbol: "SOL",
    defaultRpcUrl: "https://rpc.solanatracker.io/public",
    explorerUrl: "https://explorer.solana.com",
    builtin: true
  },
  {
    id: "mock",
    family: "mock",
    name: "Local Demo Chain",
    chainReference: "local",
    nativeCurrencySymbol: "TEST",
    builtin: true
  }
] as const;

export function isBuiltinChainId(chainId: string): chainId is BuiltinChainId {
  return BUILTIN_CHAINS.some((chain) => chain.id === chainId);
}

export type WalletSignatureInput = {
  chainId: ChainId;
  address: string;
  message: string;
  signature: string;
};

export type NftHolding = {
  chainId: ChainId;
  collectionId: string;
  tokenId: string;
  ownerAddress: string;
  traits?: Record<string, string | number | boolean>;
};

export type TokenBalance = {
  chainId: ChainId;
  tokenId: string;
  ownerAddress: string;
  amount: bigint;
  decimals: number;
};

export type ChainAdapter = {
  family: ChainFamily;
  supports(chain: ChainDefinition): boolean;
  verifySignature(input: WalletSignatureInput): Promise<boolean>;
  getNftHoldings(
    chainId: ChainId,
    address: string,
    collectionId?: string
  ): Promise<NftHolding[]>;
  getTokenBalance(chainId: ChainId, address: string, tokenId: string): Promise<TokenBalance>;
};

export class MockChainAdapter implements ChainAdapter {
  family = "mock" as const;

  supports(chain: ChainDefinition): boolean {
    return chain.family === this.family;
  }

  async verifySignature(input: WalletSignatureInput): Promise<boolean> {
    return (
      input.chainId === "mock" &&
      input.address.length > 0 &&
      input.message.length > 0 &&
      input.signature.length > 0
    );
  }

  async getNftHoldings(
    chainId: ChainId,
    address: string,
    collectionId = "demo-collection"
  ): Promise<NftHolding[]> {
    return [
      {
        chainId,
        collectionId,
        tokenId: "demo-token-1",
        ownerAddress: address,
        traits: {
          tier: "founder"
        }
      }
    ];
  }

  async getTokenBalance(
    chainId: ChainId,
    address: string,
    tokenId: string
  ): Promise<TokenBalance> {
    return {
      chainId,
      tokenId,
      ownerAddress: address,
      amount: 100n,
      decimals: 0
    };
  }
}
