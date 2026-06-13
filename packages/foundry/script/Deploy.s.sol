// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agentAddr = vm.envOr("AGENT_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);
        new AgentWallet(agentAddr);
        vm.stopBroadcast();
    }
}
