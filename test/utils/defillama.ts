import axios from 'axios';
import { BigNumber, utils } from 'ethers';

export const getLastPrice = async (network: string, coin: string): Promise<number> => {
  return await getPrice(network, coin);
};

export const getPrice = async (network: string, coin: string, timestamp?: number): Promise<number> => {
  const coinId = `${network}:${coin.toLowerCase()}`;
  const response = await axios.post('https://coins.llama.fi/prices', { coins: [coinId], timestamp });

  const { coins } = response.data;

  return coins[coinId].price;
};

export const convertPriceToBigNumberWithDecimals = (price: number, decimals: number): BigNumber => {
  return utils.parseUnits(price.toFixed(decimals), decimals);
};

export const convertPriceToNumberWithDecimals = (price: number, decimals: number): number => {
  return convertPriceToBigNumberWithDecimals(price, decimals).toNumber();
};
