import type { NftHolding, TokenBalance } from "@holder-rewards/chains";

export type CollectionRule = {
  type: "collection";
  collectionId: string;
  minCount: number;
};

export type TokenRule = {
  type: "token";
  tokenId: string;
  minAmount: string;
};

export type TraitRule = {
  type: "trait";
  collectionId: string;
  traitName: string;
  traitValue: string | number | boolean;
  minCount: number;
};

export type HolderRule = CollectionRule | TokenRule | TraitRule;

export type RuleEvaluationInput = {
  rule: HolderRule;
  nftHoldings: NftHolding[];
  tokenBalances: TokenBalance[];
};

export type RuleEvaluationResult = {
  qualifies: boolean;
  reason: string;
};

export function evaluateRule(input: RuleEvaluationInput): RuleEvaluationResult {
  switch (input.rule.type) {
    case "collection": {
      const rule = input.rule;
      const count = input.nftHoldings.filter(
        (holding) => holding.collectionId === rule.collectionId
      ).length;

      return {
        qualifies: count >= rule.minCount,
        reason: `Found ${count}/${rule.minCount} NFTs in ${rule.collectionId}.`
      };
    }

    case "token": {
      const rule = input.rule;
      const balance = input.tokenBalances.find((item) => item.tokenId === rule.tokenId);
      const amount = balance?.amount ?? 0n;
      const required = BigInt(rule.minAmount);

      return {
        qualifies: amount >= required,
        reason: `Found ${amount.toString()}/${required.toString()} tokens for ${rule.tokenId}.`
      };
    }

    case "trait": {
      const rule = input.rule;
      const count = input.nftHoldings.filter((holding) => {
        return (
          holding.collectionId === rule.collectionId &&
          holding.traits?.[rule.traitName] === rule.traitValue
        );
      }).length;

      return {
        qualifies: count >= rule.minCount,
        reason: `Found ${count}/${rule.minCount} NFTs with ${rule.traitName}=${String(
          rule.traitValue
        )}.`
      };
    }
  }
}
