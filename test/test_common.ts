import { describe, it } from "mocha";
import sinon from "sinon";
import { assert } from "chai";
import { getOutputOpts, jsSHABase } from "../src/common";
import { packedValue } from "../src/converters";

describe("Test getOutputOpts", () => {
  it("Empty Input", () => {
    assert.deepEqual(getOutputOpts(), { outputUpper: false, b64Pad: "=", shakeLen: -1 });
  });

  it("b64Pad Specified", () => {
    assert.deepEqual(getOutputOpts({ b64Pad: "#" }), { outputUpper: false, b64Pad: "#", shakeLen: -1 });
  });

  it("shakeLen Specified", () => {
    assert.deepEqual(getOutputOpts({ shakeLen: 8 }), { outputUpper: false, b64Pad: "=", shakeLen: 8 });
  });

  it("Invalid shakeLen", () => {
    assert.throws(() => {
      getOutputOpts({ shakeLen: 1 });
    }, "shakeLen must be a multiple of 8");
  });

  it("Invalid b64Pad", () => {
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore - Deliberate bad b64Pad value to test exceptions
      getOutputOpts({ b64Pad: 1 });
    }, "Invalid b64Pad formatting option");
  });

  it("Invalid outputUpper", () => {
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore - Deliberate bad outputUpper value to test exceptions
      getOutputOpts({ outputUpper: 1 });
    }, "Invalid outputUpper formatting option");
  });
});

describe("Test jsSHABase", () => {
  const stubbedStrConverter = sinon.stub(),
    stubbedRound = sinon.stub(),
    stubbedNewState = sinon.stub(),
    stubbedFinalize = sinon.stub(),
    stubbedStateClone = sinon.stub(),
    dummyVals = [
      0x11223344,
      0xaabbccdd,
      0xdeadbeef,
      0xfacefeed,
      0xbaddcafe,
      0xdeadcafe,
      0xdead2bad,
      0xdeaddead,
      0xcafed00d,
      0xdecafbad,
      0xfee1dead,
      0xdeadfa11,
    ];

  class jsSHAATest extends jsSHABase<number[], "SHA-TEST"> {
    intermediateState: number[];
    variantBlockSize: number;
    bigEndianMod: -1 | 1;
    outputBinLen: number;
    isSHAKE: boolean;

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    converterFunc: (input: any, existingBin: number[], existingBinLen: number) => packedValue;
    roundFunc: (block: number[], H: number[]) => number[];
    finalizeFunc: (remainder: number[], remainderBinLen: number, processedBinLen: number, H: number[]) => number[];
    stateCloneFunc: (state: number[]) => number[];
    newStateFunc: (variant: "SHA-TEST") => number[];

    constructor(
      variant: "SHA-TEST",
      inputFormat: "HEX" | "TEXT" | "B64" | "BYTES" | "ARRAYBUFFER" | "UINT8ARRAY",
      options?: { encoding?: "UTF8" | "UTF16BE" | "UTF16LE"; numRounds?: number }
    ) {
      super(variant, inputFormat, options);

      this.bigEndianMod = -1;
      this.converterFunc = stubbedStrConverter;
      this.roundFunc = stubbedRound;
      this.stateCloneFunc = stubbedStateClone;
      this.newStateFunc = (stubbedNewState as unknown) as (variant: "SHA-TEST") => number[];
      this.finalizeFunc = stubbedFinalize;

      this.intermediateState = [0, 0];
      this.variantBlockSize = 64;
      this.outputBinLen = 64;
      this.isSHAKE = false;
    }

    /*
     * Dirty hack function to expose the protected members of jsSHABase
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getter(propName: string): any {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore - Override "any" ban as this is only used in testing
      return this[propName];
    }

    /*
     * Dirty hack function to expose the protected members of jsSHABase
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setter(propName: string, value: any): void {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore - Override "any" ban as this is only used in testing
      this[propName] = value;
    }
  }

  it("Test Constructor with Empty Options", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");

    assert.equal(stubbedJsSHA.getter("inputFormat"), "HEX");
    assert.equal(stubbedJsSHA.getter("utfType"), "UTF8");
    assert.equal(stubbedJsSHA.getter("shaVariant"), "SHA-TEST");
    assert.equal(stubbedJsSHA.getter("numRounds"), 1);
    assert.equal(stubbedJsSHA.getter("remainderLen"), 0);
    assert.equal(stubbedJsSHA.getter("processedLen"), 0);
    assert.isFalse(stubbedJsSHA.getter("updateCalled"));
    assert.isFalse(stubbedJsSHA.getter("hmacKeySet"));
    assert.deepEqual(stubbedJsSHA.getter("inputOptions"), {});
    assert.deepEqual(stubbedJsSHA.getter("remainder"), []);
    assert.deepEqual(stubbedJsSHA.getter("keyWithIPad"), []);
    assert.deepEqual(stubbedJsSHA.getter("keyWithOPad"), []);
  });

  it("Test Constructor with Bad numRounds", () => {
    assert.throws(() => {
      new jsSHAATest("SHA-TEST", "HEX", { numRounds: 1.2 });
    }, "numRounds must a integer >= 1");

    assert.throws(() => {
      new jsSHAATest("SHA-TEST", "HEX", { numRounds: -1 });
    }, "numRounds must a integer >= 1");
  });

  it("Test update", () => {
    /*
     * This is rather difficult to test so we want to check a few basic things:
     *   1. It passed the input to the string conversion function correctly
     *   2. It did *not* call the round function when the input was smaller than the block size
     *   3. Intermediate state was untouched but remainder variables are updated
     *   4. It *did* call the round function when the input was greater than or equal to than the block size
     *   5. Intermediate state and associated variables are set correctly
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX"),
      inputStr = "ABCD";
    sinon.reset();

    stubbedStrConverter
      .onFirstCall()
      .returns({ value: [dummyVals[0]], binLen: 32 })
      .onSecondCall()
      .returns({ value: [dummyVals[0], dummyVals[0]], binLen: 64 });
    stubbedRound.returns([dummyVals[1], dummyVals[2]]);

    stubbedJsSHA.update(inputStr);
    // Check #1
    assert.isTrue(stubbedStrConverter.calledOnceWith(inputStr, [], 0));
    // Check #2
    assert.isFalse(stubbedRound.called);
    // Check #3
    assert.deepEqual(stubbedJsSHA.getter("intermediateState"), [0, 0]);
    assert.deepEqual(stubbedJsSHA.getter("remainder"), [dummyVals[0]]);
    assert.equal(stubbedJsSHA.getter("remainderLen"), 32);
    assert.equal(stubbedJsSHA.getter("processedLen"), 0);
    assert.isTrue(stubbedJsSHA.getter("updateCalled"));

    stubbedJsSHA.update(inputStr);
    // Check #1 again to make sure state is being passed correctly
    assert.equal(stubbedStrConverter.callCount, 2);
    assert.isTrue(stubbedStrConverter.getCall(1).calledWithExactly(inputStr, [dummyVals[0]], 32));
    // Check #4
    assert.isTrue(stubbedRound.calledOnceWith([dummyVals[0], dummyVals[0]], [0, 0]));

    // Check #5
    assert.deepEqual(stubbedJsSHA.getter("intermediateState"), [dummyVals[1], dummyVals[2]]);
    assert.deepEqual(stubbedJsSHA.getter("remainder"), []);
    assert.equal(stubbedJsSHA.getter("remainderLen"), 0);
    assert.equal(stubbedJsSHA.getter("processedLen"), 64);
  });

  it("Test getHash Without Needed shakeLen ", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");

    stubbedJsSHA.setter("isSHAKE", true);
    assert.throws(() => {
      stubbedJsSHA.getHash("HEX", {});
    }, "shakeLen must be specified in options");
  });

  it("Test getHash After setHMACKey Called", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    sinon.reset();

    // Bare minimum stubs for function not to throw exceptions
    stubbedStrConverter.returns({ value: [dummyVals[0]], binLen: 32 });
    stubbedNewState.returns({ value: [dummyVals[0], dummyVals[1]], binLen: 32 });
    stubbedFinalize.returns([dummyVals[2], dummyVals[3]]);

    stubbedJsSHA.setHMACKey("ABCD", "HEX");

    assert.throws(() => {
      stubbedJsSHA.getHash("HEX");
    }, "Cannot call getHash after setting HMAC key");
  });

  it("Test getHash", () => {
    /*
     * Check a few basic things:
     *   1. The output of getHash should equal the first outputBinLen bits of the output of finalizeFunc
     *   2. intermediateState and remainder should not be changed by calling getHash
     *   3. finalize should be called once with the correct inputs
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    sinon.reset();
    stubbedFinalize.returns([dummyVals[0], dummyVals[1]]);
    stubbedStateClone.returns([dummyVals[2], dummyVals[3]]);

    stubbedJsSHA.setter("intermediateState", [dummyVals[4]]);
    const intermediateState = stubbedJsSHA.getter("intermediateState");
    stubbedJsSHA.setter("remainder", [dummyVals[5]]);
    const remainder = stubbedJsSHA.getter("remainder");
    stubbedJsSHA.setter("remainderLen", 32);
    stubbedJsSHA.setter("processedLen", 64);

    // Check #1
    assert.equal(stubbedJsSHA.getHash("HEX"), dummyVals[0].toString(16) + dummyVals[1].toString(16));

    // Check #2, note deliberate use of equal vs deepEqual
    assert.equal(intermediateState, stubbedJsSHA.getter("intermediateState"));
    assert.equal(remainder, stubbedJsSHA.getter("remainder"));

    // Check #3
    assert.isTrue(
      stubbedFinalize.calledOnceWith(
        [dummyVals[5]],
        32,
        64,
        [dummyVals[2], dummyVals[3]],
        stubbedJsSHA.getter("outputBinLen")
      )
    );
  });

  it("Test getHash for SHAKE", () => {
    /*
     * Check a few basic things:
     *   1. The output of getHash should equal the first shakeLen bits of the output of finalizeFunc
     *   2. finalize should be called once with the correct inputs
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    stubbedJsSHA.setter("isSHAKE", true);
    sinon.reset();
    stubbedFinalize.returns([dummyVals[0], dummyVals[1]]);
    stubbedStateClone.returns([dummyVals[2], dummyVals[3]]);

    stubbedJsSHA.setter("intermediateState", [dummyVals[4]]);
    stubbedJsSHA.setter("remainder", [dummyVals[5]]);
    stubbedJsSHA.setter("remainderLen", 32);
    stubbedJsSHA.setter("processedLen", 64);

    // Check #1
    assert.equal(stubbedJsSHA.getHash("HEX", { shakeLen: 32 }), dummyVals[0].toString(16));

    // Check #2
    assert.isTrue(stubbedFinalize.calledOnceWith([dummyVals[5]], 32, 64, [dummyVals[2], dummyVals[3]], 32));
  });

  it("Test getHash for numRounds=3", () => {
    /*
     * Check a few basic things:
     *   1. The output of getHash should equal the output of last finalizeFunc call
     *   2. finalizeFunc should be called numRound times
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX", { numRounds: 3 });
    sinon.reset();
    stubbedFinalize.returns([dummyVals[0], dummyVals[1]]).onCall(2).returns([dummyVals[2], dummyVals[3]]);

    // Check #1
    assert.equal(stubbedJsSHA.getHash("HEX"), dummyVals[2].toString(16) + dummyVals[3].toString(16));

    // Check #2
    assert.equal(stubbedFinalize.callCount, 3);
  });

  it("Test getHash for SHAKE numRounds=3", () => {
    /*
     * Check a few basic things:
     *   1. The output of getHash should equal the output of last finalizeFunc call
     *   2. finalizeFunc should be called numRound times
     *   3. The last numRound-1 calls of finalizeFunc should have the last 32-shakeLen bits 0ed out
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX", { numRounds: 3 });
    stubbedJsSHA.setter("isSHAKE", true);
    sinon.reset();
    stubbedFinalize.returns([dummyVals[0], dummyVals[1]]).onCall(2).returns([dummyVals[2], dummyVals[3]]);

    // Check #1
    assert.equal(stubbedJsSHA.getHash("HEX", { shakeLen: 24 }), dummyVals[2].toString(16).substr(0, 6));

    // Check #2
    assert.equal(stubbedFinalize.callCount, 3);

    // Check #3
    stubbedFinalize.getCall(1).calledWith([dummyVals[0], dummyVals[1] & 0x00ffffff], 24);
    stubbedFinalize.getCall(2).calledWith([dummyVals[0], dummyVals[1] & 0x00ffffff], 24);
  });

  it("Test setHMACKey with Short Key", () => {
    /*
     * Check a few basic things:
     *   1. keyWithIPad is set correctly
     *   2. keyWithOPad is set correctly
     *   3. The round function was called and its return value stored as intermediateState
     *   4. hmacKeySet was set
     *   5. processedLen was updated
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    sinon.reset();
    stubbedRound.returns([dummyVals[0], dummyVals[1]]);
    stubbedJsSHA.setHMACKey("ABCDEFGH", "TEXT");

    // Check #1
    assert.deepEqual(
      stubbedJsSHA.getter("keyWithIPad"),
      [0x41424344, 0x45464748].map((val) => {
        return val ^ 0x36363636;
      })
    );

    // Check #2
    assert.deepEqual(
      stubbedJsSHA.getter("keyWithOPad"),
      [0x41424344, 0x45464748].map((val) => {
        return val ^ 0x5c5c5c5c;
      })
    );

    // Check #3
    assert.isTrue(
      stubbedRound.calledOnceWithExactly(
        [0x41424344, 0x45464748].map((val) => {
          return val ^ 0x36363636;
        }),
        [0, 0]
      )
    );
    assert.deepEqual(stubbedJsSHA.getter("intermediateState"), [dummyVals[0], dummyVals[1]]);

    // Check #4
    assert.isTrue(stubbedJsSHA.getter("hmacKeySet"));

    // Check #5
    assert.equal(stubbedJsSHA.getter("processedLen"), stubbedJsSHA.getter("variantBlockSize"));
  });

  it("Test setHMACKey with Long Key", () => {
    /*
     * Check a few basic things:
     *   1. Finalize was called with the correct keying material
     *   2. keyWithIPad is set correctly
     *   3. keyWithOPad is set correctly
     *   4. The round function was called with the input set as the output from finalize and its return value stored as intermediateState
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX"),
      inputStr = "ABCDEFGHABCD",
      inputStrPacked = [0x41424344, 0x45464748, 0x41424344];
    sinon.reset();
    stubbedFinalize.returns([dummyVals[0], dummyVals[1]]);
    stubbedRound.returns([dummyVals[2], dummyVals[3]]);
    stubbedNewState.returns([dummyVals[4], dummyVals[5]]);

    // Need to call setHMACKey with more than 64-bits of key material to test handling of "large" key sizes
    stubbedJsSHA.setHMACKey(inputStr, "TEXT");

    // Check #1
    assert.isTrue(
      stubbedFinalize.calledOnceWithExactly(
        inputStrPacked,
        96,
        0,
        [dummyVals[4], dummyVals[5]],
        stubbedJsSHA.getter("outputBinLen")
      )
    );

    // Check #2
    assert.deepEqual(
      stubbedJsSHA.getter("keyWithIPad"),
      [dummyVals[0], dummyVals[1]].map((val) => {
        return val ^ 0x36363636;
      })
    );

    // Check #3
    assert.deepEqual(
      stubbedJsSHA.getter("keyWithOPad"),
      [dummyVals[0], dummyVals[1]].map((val) => {
        return val ^ 0x5c5c5c5c;
      })
    );

    // Check #4
    assert.isTrue(
      stubbedRound.calledOnceWithExactly(
        [dummyVals[0], dummyVals[1]].map((val) => {
          return val ^ 0x36363636;
        }),
        [0, 0]
      )
    );
    assert.deepEqual(stubbedJsSHA.getter("intermediateState"), [dummyVals[2], dummyVals[3]]);
  });

  it("Test setHMACKey Error on Double Call", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    stubbedJsSHA.setter("hmacKeySet", true);
    sinon.reset();

    assert.throws(() => {
      stubbedJsSHA.setHMACKey("ABCD", "TEXT");
    }, "HMAC key already set");
  });

  it("Test setHMACKey Error on After update", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    stubbedJsSHA.setter("updateCalled", true);
    sinon.reset();

    assert.throws(() => {
      stubbedJsSHA.setHMACKey("ABCD", "TEXT");
    }, "Cannot set HMAC key after calling update");
  });

  it("Test setHMACKey Error on SHAKE Variant", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    stubbedJsSHA.setter("isSHAKE", true);
    sinon.reset();

    assert.throws(() => {
      stubbedJsSHA.setHMACKey("ABCD", "TEXT");
    }, "SHAKE is not supported for HMAC");
  });

  it("Test getHMAC", () => {
    /*
     * Check a few basic things:
     *   1. It returns the formatted output of the last finalizeFunc call
     *   2. finalizeFunc was called with a clone of the remainder and correct parameters
     *   3. roundFunc was called with keyWithOPad
     *   4. finalizeFunc was called with the output of the previous finalizeFunc's output and the roundFunc's state
     *   5. remainder, intermediateState, and remainderLen remain untouched
     */
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX"),
      intermediateState = [dummyVals[6], dummyVals[7]],
      remainder = [dummyVals[0]],
      keyWithOPad = [dummyVals[10], dummyVals[11]],
      newState = [dummyVals[8], dummyVals[9]],
      clonedState = [dummyVals[6], dummyVals[7]];
    sinon.reset();

    stubbedFinalize
      .onCall(0)
      .returns([dummyVals[0], dummyVals[1]])
      .onCall(1)
      .returns([[dummyVals[2]], dummyVals[3]]);
    stubbedRound.returns([dummyVals[4], dummyVals[5]]);
    stubbedStateClone.returns(clonedState);
    stubbedNewState.returns(newState);

    stubbedJsSHA.setter("hmacKeySet", true);
    stubbedJsSHA.setter("processedLen", 64);
    stubbedJsSHA.setter("keyWithOPad", keyWithOPad);
    stubbedJsSHA.setter("remainder", remainder);
    stubbedJsSHA.setter("remainderLen", 32);
    stubbedJsSHA.setter("intermediateState", intermediateState);

    // Check #1
    assert.equal(stubbedJsSHA.getHMAC("HEX"), "deadbeeffacefeed");

    // Check #2
    stubbedFinalize
      .getCall(0)
      .calledWithExactly(
        remainder,
        32,
        stubbedJsSHA.getter("outputBinLen"),
        clonedState,
        stubbedJsSHA.getter("outputBinLen")
      );

    // Check #3
    stubbedRound.calledOnceWithExactly(keyWithOPad, newState);

    // Check #4
    stubbedFinalize
      .getCall(1)
      .calledWithExactly(
        [dummyVals[0], dummyVals[1]],
        stubbedJsSHA.getter("outputBinLen"),
        stubbedJsSHA.getter("variantBlockSize"),
        [dummyVals[4], dummyVals[5]],
        stubbedJsSHA.getter("outputBinLen")
      );

    // Check #5
    assert.equal(stubbedJsSHA.getter("remainder"), remainder);
    assert.equal(stubbedJsSHA.getter("remainderLen"), 32);
    assert.equal(stubbedJsSHA.getter("intermediateState"), intermediateState);
  });

  it("Test getHMAC Error on Not Setting HMAC Key", () => {
    const stubbedJsSHA = new jsSHAATest("SHA-TEST", "HEX");
    sinon.reset();

    assert.throws(() => {
      stubbedJsSHA.getHMAC("HEX");
    }, "Cannot call getHMAC without first setting HMAC key");
  });
});
