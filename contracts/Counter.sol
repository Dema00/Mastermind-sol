// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;
import "hardhat/console.sol";

contract Counter {
    uint public count;

    function get() public view returns (uint) {
        return count;
    }

    function inc() public {
        count += 1;
        console.log("Incrementato di uno");
    }

    function dec() public {
        // will fail if count==0
        count -= 1;
        console.log("Decrementato di uno");
    }
}
