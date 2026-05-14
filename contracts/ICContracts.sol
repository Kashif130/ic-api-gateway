// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// ─────────────────────────────────────────────────────────────────────────────
// IAPIGateway.sol
// On-chain interface for Intelligent Contracts to request external API data.
// The actual HTTP calls happen off-chain via the Oracle Keeper.
// Deploy this interface — the oracle keeper watches for APIRequest events
// and calls fulfillRequest() with signed data.
// ─────────────────────────────────────────────────────────────────────────────

interface IAPIGateway {
    function requestData(
        string calldata service,   // "weather" | "price" | "social"
        string calldata action,    // e.g. "current", "price", "sentiment"
        string calldata params,    // JSON string of params: {"location":"NYC"}
        address callbackContract,  // who receives the fulfilled data
        bytes4 callbackSelector   // function selector to call on fulfillment
    ) external returns (bytes32 requestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: Weather-triggered payout contract
// ─────────────────────────────────────────────────────────────────────────────

contract CropInsurance {
    IAPIGateway public gateway;
    address payable public farmer;
    uint256 public coverageAmount;
    string  public region;
    bool    public claimed;

    bytes32 public pendingRequestId;

    event PayoutTriggered(address indexed farmer, uint256 amount, string reason);
    event WeatherChecked(string region, string condition, int256 temp);

    constructor(address _gateway, address payable _farmer, string memory _region) payable {
        gateway  = IAPIGateway(_gateway);
        farmer   = _farmer;
        region   = _region;
        coverageAmount = msg.value;
    }

    // Anyone can trigger a weather check (oracle keeper handles the HTTP call)
    function requestWeatherCheck() external {
        require(!claimed, "Already claimed");
        pendingRequestId = gateway.requestData(
            "weather",
            "current",
            string(abi.encodePacked('{"location":"', region, '","units":"metric"}')),
            address(this),
            this.fulfillWeather.selector
        );
    }

    // Called by oracle keeper with signed weather data
    function fulfillWeather(
        bytes32 requestId,
        int256  temp,          // temperature * 100 (e.g. 4250 = 42.50°C)
        string calldata condition,
        bytes calldata signature   // HMAC signature from gateway
    ) external {
        require(requestId == pendingRequestId, "Unknown request");
        // In production: verify signature against oracle keeper's public key

        emit WeatherChecked(region, condition, temp);

        // Payout condition: temp > 42°C (extreme heat event)
        if (temp > 4200 && !claimed) {
            claimed = true;
            uint256 payout = coverageAmount;
            coverageAmount = 0;
            farmer.transfer(payout);
            emit PayoutTriggered(farmer, payout, "Extreme heat event");
        }
    }

    receive() external payable {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: Price-based liquidation guard
// ─────────────────────────────────────────────────────────────────────────────

contract LiquidationGuard {
    IAPIGateway public gateway;

    struct Position {
        uint256 collateralWei;
        uint256 debtUSD;       // USD * 1e6
        bool    active;
    }

    mapping(address => Position) public positions;
    mapping(bytes32 => address)  public pendingChecks; // requestId => user
    uint256 public constant LTV_THRESHOLD = 80; // 80%

    event LiquidationTriggered(address indexed user, uint256 ltv, uint256 ethPrice);

    constructor(address _gateway) {
        gateway = IAPIGateway(_gateway);
    }

    function openPosition(uint256 debtUSD) external payable {
        positions[msg.sender] = Position({
            collateralWei: msg.value,
            debtUSD: debtUSD,
            active: true
        });
    }

    function checkLiquidation(address user) external {
        require(positions[user].active, "No active position");
        bytes32 rid = gateway.requestData(
            "price",
            "twap",
            '{"pair":"ETH/USD","interval":3600}',
            address(this),
            this.fulfillPrice.selector
        );
        pendingChecks[rid] = user;
    }

    function fulfillPrice(
        bytes32 requestId,
        uint256 twapUSD,   // price * 1e6
        bytes calldata signature
    ) external {
        address user = pendingChecks[requestId];
        require(user != address(0), "Unknown request");
        delete pendingChecks[requestId];

        Position storage pos = positions[user];
        if (!pos.active) return;

        uint256 collateralUSD = (pos.collateralWei * twapUSD) / 1e18;
        uint256 ltv = (pos.debtUSD * 100) / collateralUSD;

        if (ltv >= LTV_THRESHOLD) {
            pos.active = false;
            emit LiquidationTriggered(user, ltv, twapUSD);
            // trigger actual liquidation logic here
        }
    }
}
