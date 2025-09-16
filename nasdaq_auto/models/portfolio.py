"""
Portfolio and trading data models
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, validator
from enum import Enum

class TradeType(str, Enum):
    """Trade types"""
    BUY = "BUY"
    SELL = "SELL"

class TradeRecord(BaseModel):
    """Individual trade record"""
    symbol: str = Field(..., description="Stock symbol")
    trade_type: TradeType = Field(..., description="Trade type (BUY/SELL)")
    shares: Decimal = Field(..., gt=0, description="Number of shares")
    price: Decimal = Field(..., gt=0, description="Price per share")
    timestamp: datetime = Field(default_factory=datetime.now, description="Trade timestamp")
    notes: Optional[str] = Field(None, description="Optional notes")

    @validator('symbol')
    def symbol_must_be_uppercase(cls, v):
        return v.upper()

class CashEvent(BaseModel):
    """Cash deposit/withdrawal event"""
    amount: Decimal = Field(..., description="Amount (positive for deposit, negative for withdrawal)")
    timestamp: datetime = Field(default_factory=datetime.now, description="Event timestamp")
    description: Optional[str] = Field(None, description="Event description")

class Holding(BaseModel):
    """Current stock holding"""
    symbol: str = Field(..., description="Stock symbol")
    shares: Decimal = Field(..., gt=0, description="Number of shares owned")
    avg_cost: Decimal = Field(..., gt=0, description="Average cost per share")
    current_price: Optional[Decimal] = Field(None, description="Current market price")

    @property
    def market_value(self) -> Optional[Decimal]:
        """Calculate current market value"""
        if self.current_price is not None:
            return self.shares * self.current_price
        return None

    @property
    def total_cost(self) -> Decimal:
        """Calculate total cost basis"""
        return self.shares * self.avg_cost

    @property
    def unrealized_pnl(self) -> Optional[Decimal]:
        """Calculate unrealized P&L"""
        if self.current_price is not None:
            return (self.current_price - self.avg_cost) * self.shares
        return None

    @property
    def unrealized_pnl_percent(self) -> Optional[Decimal]:
        """Calculate unrealized P&L percentage"""
        if self.current_price is not None:
            return ((self.current_price - self.avg_cost) / self.avg_cost) * 100
        return None

class Portfolio(BaseModel):
    """Complete portfolio state"""
    cash_balance: Decimal = Field(default=Decimal('0'), description="Current cash balance in USD")
    holdings: List[Holding] = Field(default_factory=list, description="Current stock holdings")
    last_updated: datetime = Field(default_factory=datetime.now, description="Last update timestamp")

    @property
    def total_market_value(self) -> Decimal:
        """Calculate total portfolio market value"""
        holdings_value = sum(
            (holding.market_value or holding.total_cost) for holding in self.holdings
        )
        return self.cash_balance + holdings_value

    @property
    def total_cost_basis(self) -> Decimal:
        """Calculate total cost basis"""
        holdings_cost = sum(holding.total_cost for holding in self.holdings)
        return self.cash_balance + holdings_cost

    @property
    def total_unrealized_pnl(self) -> Decimal:
        """Calculate total unrealized P&L"""
        return sum(
            (holding.unrealized_pnl or Decimal('0')) for holding in self.holdings
        )

    @property
    def total_unrealized_pnl_percent(self) -> Decimal:
        """Calculate total unrealized P&L percentage"""
        if self.total_cost_basis > 0:
            return (self.total_unrealized_pnl / self.total_cost_basis) * 100
        return Decimal('0')

class MarketData(BaseModel):
    """Market data for a single symbol"""
    symbol: str = Field(..., description="Stock symbol")
    timestamp: datetime = Field(..., description="Data timestamp")
    open: Decimal = Field(..., description="Opening price")
    high: Decimal = Field(..., description="High price")
    low: Decimal = Field(..., description="Low price")
    close: Decimal = Field(..., description="Closing price")
    volume: int = Field(..., description="Trading volume")
    adj_close: Optional[Decimal] = Field(None, description="Adjusted closing price")

class TechnicalIndicators(BaseModel):
    """Technical analysis indicators"""
    symbol: str = Field(..., description="Stock symbol")
    timestamp: datetime = Field(..., description="Calculation timestamp")

    # Price data
    close: Decimal = Field(..., description="Current close price")

    # Moving averages
    sma_20: Optional[Decimal] = Field(None, description="20-day Simple Moving Average")
    sma_50: Optional[Decimal] = Field(None, description="50-day Simple Moving Average")
    ema_20: Optional[Decimal] = Field(None, description="20-day Exponential Moving Average")
    ema_50: Optional[Decimal] = Field(None, description="50-day Exponential Moving Average")

    # Momentum indicators
    rsi_14: Optional[Decimal] = Field(None, description="14-day RSI")
    macd: Optional[Decimal] = Field(None, description="MACD")
    macd_signal: Optional[Decimal] = Field(None, description="MACD Signal")
    macd_histogram: Optional[Decimal] = Field(None, description="MACD Histogram")

    # Volatility indicators
    bb_upper: Optional[Decimal] = Field(None, description="Bollinger Band Upper")
    bb_middle: Optional[Decimal] = Field(None, description="Bollinger Band Middle")
    bb_lower: Optional[Decimal] = Field(None, description="Bollinger Band Lower")

    # Volume indicators
    volume_sma_20: Optional[Decimal] = Field(None, description="20-day Volume SMA")

class NewsItem(BaseModel):
    """News article data"""
    title: str = Field(..., description="Article title")
    description: Optional[str] = Field(None, description="Article description")
    url: str = Field(..., description="Article URL")
    source: str = Field(..., description="News source")
    published_at: datetime = Field(..., description="Publication timestamp")
    symbols: List[str] = Field(default_factory=list, description="Related symbols")
    sentiment: Optional[str] = Field(None, description="Sentiment analysis result")

class PerformanceMetrics(BaseModel):
    """Portfolio performance metrics"""
    period_start: datetime = Field(..., description="Performance period start")
    period_end: datetime = Field(..., description="Performance period end")

    # Returns
    total_return: Decimal = Field(..., description="Total return")
    total_return_percent: Decimal = Field(..., description="Total return percentage")
    annualized_return: Optional[Decimal] = Field(None, description="Annualized return")

    # Risk metrics
    volatility: Optional[Decimal] = Field(None, description="Portfolio volatility")
    sharpe_ratio: Optional[Decimal] = Field(None, description="Sharpe ratio")
    max_drawdown: Optional[Decimal] = Field(None, description="Maximum drawdown")

    # Holdings metrics
    largest_holding_percent: Optional[Decimal] = Field(None, description="Largest holding percentage")
    num_holdings: int = Field(..., description="Number of holdings")

    # Benchmark comparison
    benchmark_return: Optional[Decimal] = Field(None, description="Benchmark return")
    alpha: Optional[Decimal] = Field(None, description="Alpha vs benchmark")
    beta: Optional[Decimal] = Field(None, description="Beta vs benchmark")