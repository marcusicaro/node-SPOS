/*
SPOS - Small Payload Object Serializer
Copyright (C) 2020 Luiz Eduardo Amaral <luizamaral306@gmail.com>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
const { utils } = require("./utils.js");

class BlockABC {
  input = [];
  required = {};
  optional = {};

  constructor(blockSpec) {
    this.blockSpec = blockSpec;
    if ("bits" in blockSpec) this.bits = blockSpec.bits;
    if ("value" in blockSpec) {
      this.value = blockSpec.value;
    }
  }

  validateBlockSpecKeys(blockSpec) {
    // Check required settings
    for (const [key, value] of Object.entries(this.required)) {
      if (!(key in blockSpec))
        throw new ReferenceError(`Block must have key 'key'`);
      if (!this.validateType(value, blockSpec[key]))
        throw new RangeError(
          `Block ${blockSpec.key} key '${key}' has unexpected type.`
        );
    }

    // Check optional settings
    Object.entries(this.optional).forEach(([key, value]) => {
      if (key in blockSpec) this.validateType(value, blockSpec[key]);
      else {
        this.blockSpec[key] = value.default;
      }
    });

    // Check for unexpected keys
    Object.keys(blockSpec).forEach((key) => {
      if (
        !(
          Object.keys(this.required).includes(key) ||
          Object.keys(this.optional).includes(key) ||
          ["key", "type", "value"].includes(key)
        )
      )
        throw new ReferenceError(
          `Block '${blockSpec.key}' has an unexpected key '${key}'.`
        );
    });
  }

  /* Abstract Method*/
  initializeBlock(blockSpec) {}

  validateValue(value) {
    if (this.validateType(this.input, value)) return true;
    throw RangeError(`Unexpected type for value ${value}, ${this.input}.`);
  }

  validateType(types, value) {
    types = Array.isArray(types) ? types : [types];
    for (let tp of types) {
      if (tp == null) return true;
      else if (tp == "boolean" && typeof value == "boolean") return true;
      else if (tp == "integer" && Number.isInteger(value)) return true;
      else if (tp == "number" && utils.isNumber(value)) return true;
      else if (tp == "string" && utils.isString(value)) return true;
      else if (tp == "bin" && utils.isString(value) && value.match(/^[0-1]+$/))
        return true;
      else if (
        tp == "hex" &&
        utils.isString(value) &&
        value.match(/^([0-9a-zA-Z]{2})+$/)
      )
        return true;
      else if (tp == "array" && Array.isArray(value)) return true;
      else if (tp == "object" && utils.isObject(value)) return true;
      else if (tp == "blocklist" && Array.isArray(value)) return true;
      else if (tp == "blocks" && utils.isObject(value)) return true;
    }
    return false;
  }

  /* Abstract Method*/
  _binEncode(value) {}
  binEncode(value) {
    if (this.value) {
      return this._binEncode(this.value);
    }
    this.validateValue(value);
    return this._binEncode(value);
  }

  /* Abstract Method*/
  _binDecode(message) {}
  binDecode(message) {
    return this._binDecode(message);
  }

  consume(message) {
    let bits = this.accumulateBits(message);
    let value = this.binDecode(message.slice(0, bits));
    return [value, message.slice(bits)];
  }

  accumulateBits(message) {
    return this.bits;
  }
}

class BooleanBlock extends BlockABC {
  input = ["boolean", "integer"];
  bits = 1;

  _binEncode(value) {
    value = Number.isInteger(value) ? value !== 0 : value;
    return value === true ? "1" : "0";
  }

  _binDecode(message) {
    return message === "1";
  }
}

class BinaryBlock extends BlockABC {
  input = ["bin", "hex"];
  required = { bits: "integer" };

  _binEncode(value) {
    value = !(value.replace(/[01]/g, "") == "")
      ? (value = parseInt(value, 16)
          .toString(2)
          .padStart(value.length * 4, "0"))
      : value;
    return value.padStart(this.bits, "0").slice(0, this.bits);
  }

  _binDecode(message) {
    return message;
  }
}

class IntegerBlock extends BlockABC {
  input = ["integer"];
  required = { bits: "integer" };
  optional = {
    offset: { type: "integer", default: 0 },
  };

  _binEncode(value) {
    const overflow = Math.pow(2, this.bits) - 1;
    value = Math.min(overflow, Math.max(0, value - this.blockSpec.offset));
    return value.toString(2).padStart(this.bits, "0");
  }

  _binDecode(message) {
    return this.blockSpec.offset + parseInt(message, 2);
  }
}

class FloatBlock extends BlockABC {
  input = ["number"];
  required = { bits: "integer" };
  optional = {
    lower: { type: "number", default: 0 },
    upper: { type: "number", default: 1 },
    approximation: {
      type: "string",
      default: "round",
      choices: ["round", "floor", "ceil"],
    },
  };

  _binEncode(value) {
    const bits = this.bits;
    const upper = this.blockSpec.upper;
    const lower = this.blockSpec.lower;
    const approximation =
      this.blockSpec.approximation == "ceil"
        ? Math.ceil
        : this.blockSpec.approximation == "floor"
        ? Math.floor
        : utils.round2Even;
    const overflow = Math.pow(2, this.bits) - 1;
    const delta = upper - lower;
    value = (overflow * (value - lower)) / delta;
    value = approximation(Math.min(overflow, Math.max(0, value)));
    return value.toString(2).padStart(this.bits, "0");
  }

  _binDecode(message) {
    const overflow = Math.pow(2, this.bits) - 1;
    return (
      (parseInt(message, 2) * (this.blockSpec.upper - this.blockSpec.lower)) /
        overflow +
      this.blockSpec.lower
    );
  }
}

class PadBlock extends BlockABC {
  input = [null];
  required = { bits: "integer" };
  _binEncode(value) {
    return "".padStart(this.bits, "1");
  }
  _binDecode(message) {
    return null;
  }
}

class ArrayBlock extends BlockABC {
  input = ["array"];
  required = { bits: "integer", blocks: "blocks" };

  initializeBlock(blockSpec) {
    this.lengthBlock = new Block({
      key: "length",
      type: "integer",
      bits: blockSpec.bits,
    });
    this.itemsBlock = new Block(blockSpec.blocks);
    this.maxLength = 2 ** this.bits - 1;
  }
  _binEncode(value) {
    let message = "";
    let length = value.length > this.maxLength ? this.maxLength : value.length;
    message += this.lengthBlock.binEncode(length);
    message += value.reduce((acc, v, idx) => {
      if (idx >= length) return acc;
      return acc + this.itemsBlock.binEncode(v);
    }, "");
    return message;
  }
  _binDecode(message) {
    let length;
    [length, message] = this.lengthBlock.consume(message);
    let value = [];
    for (let i = 0; i < length; i++) {
      let v;
      [v, message] = this.itemsBlock.consume(message);
      value.push(v);
    }
    return value;
  }
  accumulateBits(message) {
    let [length, msg] = this.lengthBlock.consume(message);
    return this.bits + length * this.itemsBlock.accumulateBits(msg);
  }
}

class ObjectBlock extends BlockABC {
  input = ["object"];
  required = { blocklist: "blocklist" };

  initializeBlock(blockSpec) {
    this.blocklist = blockSpec.blocklist.map((b_spec) => new Block(b_spec));
  }
  getValue(key, obj) {
    let ks = key.split(".");
    if (ks.length > 1) return this.getValue(ks.slice(1).join("."), obj[ks[0]]);
    return obj[key];
  }
  nestObject(obj) {
    let newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      let kSplit = key.split(".");
      let newVal;
      if (kSplit.length > 1) {
        let inKey = kSplit[0];
        let newKey = kSplit.slice(1).join(".");
        let nest = {};
        nest[newKey] = value;
        newVal = this.nestObject(nest);
        newObj[inKey] = Object.assign({}, newObj[inKey], newVal);
      } else {
        if (Array.isArray(value)) {
          if (utils.isObject(value[0]))
            newObj[key] = value.map(this.nestObject);
          else newObj[key] = value;
        } else if (utils.isObject(value)) {
          newObj[key] = Object.assign({}, newObj[key], value);
        } else {
          newObj[key] = value;
        }
      }
    }
    return newObj;
  }
  _binEncode(value) {
    return this.blocklist
      .map((block) =>
        block.binEncode(this.getValue(block.blockSpec.key, value))
      )
      .join("");
  }
  _binDecode(message) {
    let values = {};
    for (let block of this.blocklist) {
      let v;
      [v, message] = block.consume(message);
      values[block.blockSpec.key] = v;
    }
    return this.nestObject(values);
  }
  accumulateBits(message) {
    return this.blocklist.reduce(
      ([bits, message], block) => {
        let b = block.accumulateBits(message);
        return [bits + b, message.slice(b)];
      },
      [0, message]
    )[0];
  }
}

class StringBlock extends BlockABC {
  input = ["string"];
  required = { length: "integer" };
  optional = { custom_alphabeth: { type: "object", default: {} } };

  initializeBlock(blockSpec) {
    const _b64_alphabeth =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    this.alphabeth = Object.fromEntries(
      new Map(
        _b64_alphabeth.split("").map((c, i) => {
          if (i in blockSpec.custom_alphabeth)
            return [blockSpec.custom_alphabeth[i], i];
          return [c, i];
        })
      )
    );
    this.rev_alphabeth = Object.entries(this.alphabeth).reduce(
      (acc, [key, value]) => {
        acc[value] = key;
        return acc;
      },
      {}
    );
    this.letterBlock = new Block({ key: "letter", type: "integer", bits: 6 });
  }
  _binEncode(value) {
    value = value
      .padStart(this.blockSpec.length, " ")
      .substring(0, this.blockSpec.length);
    return value
      .split("")
      .map((char) =>
        char in this.alphabeth ? this.alphabeth[char] : char == " " ? 62 : 63
      )
      .map((index) => this.letterBlock.binEncode(index))
      .join("");
  }
  _binDecode(message) {
    return new Array(message.length / 6)
      .fill(0)
      .map((_, i) => message.substring(6 * i, 6 * (i + 1)))
      .map((message) => this.letterBlock.binDecode(message))
      .map((index) => this.rev_alphabeth[index])
      .join("");
  }
}

class StepsBlock extends BlockABC {
  input = "number";
  required = { steps: "array" };
  optional = { steps_names: { type: "array", default: [] } };

  initializeBlock(blockSpec) {
    if (!utils.isSorted(this.blockSpec.steps))
      throw RangeError(`Steps Block must be ordered`);
    this.bits = Math.ceil(Math.log(this.blockSpec.steps.length + 1, 2));
    this.stepsBlock = new Block({
      key: "steps",
      type: "integer",
      bits: this.bits,
      offset: 0,
    });
    if (this.blockSpec.steps_names.length == 0) {
      this.blockSpec.steps_names = [`x<${this.blockSpec.steps[0]}`];
      for (let i = 0; i <= this.blockSpec.steps.length - 2; i++) {
        this.blockSpec.steps_names.push(
          `${this.blockSpec.steps[i]}<=x<${this.blockSpec.steps[i + 1]}`
        );
      }
      this.blockSpec.steps_names.push(
        `x>=${this.blockSpec.steps.slice(-1)[0]}`
      );
    }
    if (this.blockSpec.steps_names.length != this.blockSpec.steps.length + 1)
      throw RangeError(`steps_names' has to have length 1 + len(steps)`);
    this.blockSpec.steps.push(Infinity);
  }
  _binEncode(value) {
    const _value = this.blockSpec.steps.reduce(
      (acc, cur, idx) => (acc != -1 ? acc : value < cur ? idx : -1),
      -1
    );
    return this.stepsBlock.binEncode(_value);
  }
  _binDecode(message) {
    let value = this.stepsBlock.binDecode(message);
    return this.blockSpec.steps_names[value];
  }
}

class CategoriesBlock extends BlockABC {
  input = "string";
  required = { categories: "array" };

  initializeBlock(blockSpec) {
    this.blockSpec.categories.push("unknown");
    this.bits = Math.ceil(Math.log(this.blockSpec.categories.length, 2));
    this.categoriesBlock = new Block({
      key: "categories",
      type: "integer",
      bits: this.bits,
      offset: 0,
    });
  }
  _binEncode(value) {
    const index = this.blockSpec.categories.indexOf(value);
    const _value = index != -1 ? index : this.blockSpec.categories.length - 1;
    return this.categoriesBlock.binEncode(_value);
  }
  _binDecode(message) {
    let value = this.categoriesBlock.binDecode(message);
    return value < this.blockSpec.categories.length
      ? this.blockSpec.categories[value]
      : "error";
  }
}

class Block {
  TYPES = {
    boolean: BooleanBlock,
    binary: BinaryBlock,
    integer: IntegerBlock,
    float: FloatBlock,
    pad: PadBlock,
    array: ArrayBlock,
    object: ObjectBlock,
    string: StringBlock,
    steps: StepsBlock,
    categories: CategoriesBlock,
  };
  constructor(blockSpec) {
    this.blockSpec = JSON.parse(JSON.stringify(blockSpec));
    this.validateBlockSpec(this.blockSpec);
    this.block = new this.TYPES[blockSpec.type](this.blockSpec);
    this.block.validateBlockSpecKeys(this.blockSpec);
    this.block.initializeBlock(this.blockSpec);
    this.binEncode = this.block.binEncode.bind(this.block);
    this.binDecode = this.block.binDecode.bind(this.block);
    this.consume = this.block.consume.bind(this.block);
    this.accumulateBits = this.block.accumulateBits.bind(this.block);
  }
  validateBlockSpec(blockSpec) {
    if (!("key" in blockSpec))
      throw new ReferenceError(
        `Block ${JSON.stringify(blockSpec)} must have 'key'.`
      );
    if (!utils.isString(blockSpec.key))
      throw new RangeError(`Block ${blockSpec.key} 'key' must be a string .`);
    if (!("type" in blockSpec))
      throw new ReferenceError(`Block ${blockSpec.key} must have 'type'.`);
    if (!(blockSpec.type in this.TYPES))
      throw new RangeError(
        `Block ${blockSpec.key} has type: ${
          blockSpec.type
        }, should be one of: ${Object.keys(this.TYPES).join(", ")}.`
      );
  }
}

module.exports.blocks = {
  Block,
};