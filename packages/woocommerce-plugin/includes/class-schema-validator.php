<?php
/**
 * Minimal JSON Schema (draft 2020-12) validator covering the keyword set that
 * @paskamer/schema emits for garment.schema.json / garment-draft.schema.json:
 *
 *   type, const, enum, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf,
 *   minLength, maxLength, pattern, format (uri, email, date-time), required, properties,
 *   additionalProperties, propertyNames, items (schema | false), prefixItems, minItems,
 *   maxItems, uniqueItems, allOf, anyOf, oneOf, not, $ref (local JSON pointers only).
 *
 * Data is the PHP-array form of JSON (`json_decode(..., true)`): a list is an array, an
 * associative array is an object, an empty array satisfies either. No WordPress dependency.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Schema_Validator {

	/** @var array<string,mixed> */
	private array $root;

	/** When true, `format: uri` additionally requires an absolute http(s) URL (what the api accepts). */
	private bool $strict_http_urls;

	/**
	 * @param array<string,mixed> $schema Decoded JSON Schema.
	 */
	public function __construct( array $schema, bool $strict_http_urls = true ) {
		$this->root             = $schema;
		$this->strict_http_urls = $strict_http_urls;
	}

	public static function from_file( string $path, bool $strict_http_urls = true ): self {
		if ( ! is_readable( $path ) ) {
			throw new \RuntimeException( 'schema file not readable: ' . $path );
		}
		$json = file_get_contents( $path );
		$data = json_decode( (string) $json, true );
		if ( ! is_array( $data ) ) {
			throw new \RuntimeException( 'schema file is not valid JSON: ' . $path );
		}
		return new self( $data, $strict_http_urls );
	}

	/**
	 * @param mixed $data
	 * @return array<int, array{path:string,message:string}> Empty when valid.
	 */
	public function validate( $data ): array {
		$issues = array();
		$this->check( $this->root, $data, '', $issues );
		return $issues;
	}

	/** @param mixed $data */
	public function is_valid( $data ): bool {
		return array() === $this->validate( $data );
	}

	/**
	 * @param array<string,mixed>|bool $schema
	 * @param mixed                    $data
	 * @param array<int, array{path:string,message:string}> $issues
	 */
	private function check( $schema, $data, string $path, array &$issues ): void {
		if ( true === $schema ) {
			return;
		}
		if ( false === $schema ) {
			$issues[] = self::issue( $path, 'not allowed' );
			return;
		}
		if ( ! is_array( $schema ) ) {
			return;
		}
		if ( isset( $schema['$ref'] ) && is_string( $schema['$ref'] ) ) {
			$resolved = $this->resolve_ref( $schema['$ref'] );
			if ( null !== $resolved ) {
				$this->check( $resolved, $data, $path, $issues );
			}
		}

		if ( isset( $schema['type'] ) && ! self::type_matches( $schema['type'], $data ) ) {
			$expected = is_array( $schema['type'] ) ? implode( '|', $schema['type'] ) : (string) $schema['type'];
			$issues[] = self::issue( $path, sprintf( 'expected %s, got %s', $expected, self::type_of( $data ) ) );
			return; // Further keyword checks are meaningless on the wrong type.
		}

		if ( array_key_exists( 'const', $schema ) && ! self::equals( $schema['const'], $data ) ) {
			$issues[] = self::issue( $path, 'expected constant ' . json_encode( $schema['const'] ) );
		}
		if ( isset( $schema['enum'] ) && is_array( $schema['enum'] ) ) {
			$found = false;
			foreach ( $schema['enum'] as $candidate ) {
				if ( self::equals( $candidate, $data ) ) {
					$found = true;
					break;
				}
			}
			if ( ! $found ) {
				$issues[] = self::issue( $path, 'expected one of ' . implode( ', ', array_map( 'strval', $schema['enum'] ) ) );
			}
		}

		if ( is_int( $data ) || is_float( $data ) ) {
			$this->check_number( $schema, $data, $path, $issues );
		} elseif ( is_string( $data ) ) {
			$this->check_string( $schema, $data, $path, $issues );
		} elseif ( is_array( $data ) ) {
			$wants_object = self::schema_wants( $schema, 'object' );
			$wants_array  = self::schema_wants( $schema, 'array' );
			$is_list      = array_is_list( $data );
			if ( ( $is_list && ! $wants_object ) || $wants_array ) {
				$this->check_array( $schema, $data, $path, $issues );
			} else {
				$this->check_object( $schema, $data, $path, $issues );
			}
		}

		if ( isset( $schema['allOf'] ) && is_array( $schema['allOf'] ) ) {
			foreach ( $schema['allOf'] as $sub ) {
				$this->check( $sub, $data, $path, $issues );
			}
		}
		if ( isset( $schema['anyOf'] ) && is_array( $schema['anyOf'] ) ) {
			$ok = false;
			foreach ( $schema['anyOf'] as $sub ) {
				$tmp = array();
				$this->check( $sub, $data, $path, $tmp );
				if ( array() === $tmp ) {
					$ok = true;
					break;
				}
			}
			if ( ! $ok ) {
				$issues[] = self::issue( $path, 'does not match any allowed variant' );
			}
		}
		if ( isset( $schema['oneOf'] ) && is_array( $schema['oneOf'] ) ) {
			$matches = 0;
			foreach ( $schema['oneOf'] as $sub ) {
				$tmp = array();
				$this->check( $sub, $data, $path, $tmp );
				if ( array() === $tmp ) {
					++$matches;
				}
			}
			if ( 1 !== $matches ) {
				$issues[] = self::issue( $path, 'must match exactly one variant' );
			}
		}
		if ( isset( $schema['not'] ) ) {
			$tmp = array();
			$this->check( $schema['not'], $data, $path, $tmp );
			if ( array() === $tmp ) {
				$issues[] = self::issue( $path, 'matches a forbidden schema' );
			}
		}
	}

	/** @param array<string,mixed> $schema @param int|float $data */
	private function check_number( array $schema, $data, string $path, array &$issues ): void {
		if ( isset( $schema['minimum'] ) && $data < $schema['minimum'] ) {
			$issues[] = self::issue( $path, 'must be >= ' . $schema['minimum'] );
		}
		if ( isset( $schema['maximum'] ) && $data > $schema['maximum'] ) {
			$issues[] = self::issue( $path, 'must be <= ' . $schema['maximum'] );
		}
		if ( isset( $schema['exclusiveMinimum'] ) && $data <= $schema['exclusiveMinimum'] ) {
			$issues[] = self::issue( $path, 'must be > ' . $schema['exclusiveMinimum'] );
		}
		if ( isset( $schema['exclusiveMaximum'] ) && $data >= $schema['exclusiveMaximum'] ) {
			$issues[] = self::issue( $path, 'must be < ' . $schema['exclusiveMaximum'] );
		}
		if ( isset( $schema['multipleOf'] ) && $schema['multipleOf'] > 0 ) {
			$q = $data / $schema['multipleOf'];
			if ( abs( $q - round( $q ) ) > 1e-9 ) {
				$issues[] = self::issue( $path, 'must be a multiple of ' . $schema['multipleOf'] );
			}
		}
	}

	/** @param array<string,mixed> $schema */
	private function check_string( array $schema, string $data, string $path, array &$issues ): void {
		$len = function_exists( 'mb_strlen' ) ? mb_strlen( $data, 'UTF-8' ) : strlen( $data );
		if ( isset( $schema['minLength'] ) && $len < $schema['minLength'] ) {
			$issues[] = self::issue( $path, 1 === (int) $schema['minLength'] ? 'must not be empty' : 'must be at least ' . $schema['minLength'] . ' characters' );
		}
		if ( isset( $schema['maxLength'] ) && $len > $schema['maxLength'] ) {
			$issues[] = self::issue( $path, 'must be at most ' . $schema['maxLength'] . ' characters' );
		}
		if ( isset( $schema['pattern'] ) && is_string( $schema['pattern'] ) ) {
			$re = '/' . str_replace( '/', '\/', $schema['pattern'] ) . '/u';
			if ( 1 !== @preg_match( $re, $data ) ) {
				$issues[] = self::issue( $path, 'does not match the expected format' );
			}
		}
		if ( isset( $schema['format'] ) && is_string( $schema['format'] ) && ! $this->format_ok( $schema['format'], $data ) ) {
			$issues[] = self::issue( $path, 'uri' === $schema['format'] ? 'must be an absolute http(s) URL' : 'invalid ' . $schema['format'] );
		}
	}

	private function format_ok( string $format, string $value ): bool {
		switch ( $format ) {
			case 'uri':
			case 'url':
				if ( false === filter_var( $value, FILTER_VALIDATE_URL ) ) {
					return false;
				}
				if ( ! $this->strict_http_urls ) {
					return true;
				}
				$scheme = strtolower( (string) parse_url( $value, PHP_URL_SCHEME ) );
				return 'http' === $scheme || 'https' === $scheme;
			case 'email':
				return false !== filter_var( $value, FILTER_VALIDATE_EMAIL );
			case 'date-time':
				return 1 === preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/', $value );
			case 'date':
				return 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value );
			case 'uuid':
				return 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value );
			default:
				return true; // Unknown formats are annotations.
		}
	}

	/** @param array<string,mixed> $schema @param array<int,mixed> $data */
	private function check_array( array $schema, array $data, string $path, array &$issues ): void {
		$n = count( $data );
		if ( isset( $schema['minItems'] ) && $n < $schema['minItems'] ) {
			$issues[] = self::issue( $path, 'must have at least ' . $schema['minItems'] . ' item(s)' );
		}
		if ( isset( $schema['maxItems'] ) && $n > $schema['maxItems'] ) {
			$issues[] = self::issue( $path, 'must have at most ' . $schema['maxItems'] . ' item(s)' );
		}
		if ( ! empty( $schema['uniqueItems'] ) ) {
			$seen = array();
			foreach ( $data as $item ) {
				$key = json_encode( $item );
				if ( isset( $seen[ $key ] ) ) {
					$issues[] = self::issue( $path, 'items must be unique' );
					break;
				}
				$seen[ $key ] = true;
			}
		}
		$prefix = isset( $schema['prefixItems'] ) && is_array( $schema['prefixItems'] ) ? $schema['prefixItems'] : array();
		$i      = 0;
		foreach ( $data as $item ) {
			$sub_path = '' === $path ? (string) $i : $path . '.' . $i;
			if ( isset( $prefix[ $i ] ) ) {
				$this->check( $prefix[ $i ], $item, $sub_path, $issues );
			} elseif ( array_key_exists( 'items', $schema ) ) {
				$this->check( $schema['items'], $item, $sub_path, $issues );
			}
			++$i;
		}
	}

	/** @param array<string,mixed> $schema @param array<string,mixed> $data */
	private function check_object( array $schema, array $data, string $path, array &$issues ): void {
		if ( isset( $schema['required'] ) && is_array( $schema['required'] ) ) {
			foreach ( $schema['required'] as $key ) {
				if ( ! array_key_exists( $key, $data ) ) {
					$issues[] = self::issue( '' === $path ? (string) $key : $path . '.' . $key, 'required' );
				}
			}
		}
		$props = isset( $schema['properties'] ) && is_array( $schema['properties'] ) ? $schema['properties'] : array();
		foreach ( $data as $key => $value ) {
			$key      = (string) $key;
			$sub_path = '' === $path ? $key : $path . '.' . $key;
			if ( isset( $schema['propertyNames'] ) ) {
				$this->check( $schema['propertyNames'], $key, $sub_path, $issues );
			}
			if ( array_key_exists( $key, $props ) ) {
				$this->check( $props[ $key ], $value, $sub_path, $issues );
			} elseif ( array_key_exists( 'additionalProperties', $schema ) ) {
				if ( false === $schema['additionalProperties'] ) {
					$issues[] = self::issue( $sub_path, 'unknown property' );
				} else {
					$this->check( $schema['additionalProperties'], $value, $sub_path, $issues );
				}
			}
		}
	}

	/** @return array<string,mixed>|null */
	private function resolve_ref( string $ref ): ?array {
		if ( '#' !== substr( $ref, 0, 1 ) ) {
			return null;
		}
		$pointer = substr( $ref, 1 );
		$node    = $this->root;
		foreach ( array_filter( explode( '/', $pointer ), 'strlen' ) as $segment ) {
			$segment = str_replace( array( '~1', '~0' ), array( '/', '~' ), $segment );
			if ( ! is_array( $node ) || ! array_key_exists( $segment, $node ) ) {
				return null;
			}
			$node = $node[ $segment ];
		}
		return is_array( $node ) ? $node : null;
	}

	/** @param array<string,mixed> $schema */
	private static function schema_wants( array $schema, string $type ): bool {
		if ( ! isset( $schema['type'] ) ) {
			return 'object' === $type && ( isset( $schema['properties'] ) || isset( $schema['required'] ) || isset( $schema['additionalProperties'] ) || isset( $schema['propertyNames'] ) )
				|| 'array' === $type && ( isset( $schema['items'] ) || isset( $schema['prefixItems'] ) || isset( $schema['minItems'] ) );
		}
		$types = is_array( $schema['type'] ) ? $schema['type'] : array( $schema['type'] );
		return in_array( $type, $types, true );
	}

	/** @param string|array<int,string> $type @param mixed $data */
	private static function type_matches( $type, $data ): bool {
		$types = is_array( $type ) ? $type : array( $type );
		foreach ( $types as $t ) {
			switch ( $t ) {
				case 'string':
					if ( is_string( $data ) ) {
						return true;
					}
					break;
				case 'number':
					if ( is_int( $data ) || is_float( $data ) ) {
						return true;
					}
					break;
				case 'integer':
					if ( is_int( $data ) || ( is_float( $data ) && floor( $data ) === $data ) ) {
						return true;
					}
					break;
				case 'boolean':
					if ( is_bool( $data ) ) {
						return true;
					}
					break;
				case 'null':
					if ( null === $data ) {
						return true;
					}
					break;
				case 'object':
					if ( is_array( $data ) && ( array() === $data || ! array_is_list( $data ) ) ) {
						return true;
					}
					if ( is_object( $data ) ) {
						return true;
					}
					break;
				case 'array':
					if ( is_array( $data ) && array_is_list( $data ) ) {
						return true;
					}
					break;
			}
		}
		return false;
	}

	/** @param mixed $data */
	private static function type_of( $data ): string {
		if ( null === $data ) {
			return 'null';
		}
		if ( is_bool( $data ) ) {
			return 'boolean';
		}
		if ( is_int( $data ) || is_float( $data ) ) {
			return 'number';
		}
		if ( is_string( $data ) ) {
			return 'string';
		}
		if ( is_array( $data ) ) {
			return array_is_list( $data ) && array() !== $data ? 'array' : 'object';
		}
		return gettype( $data );
	}

	/** JSON equality (1 == 1.0, arrays compared by value). @param mixed $a @param mixed $b */
	private static function equals( $a, $b ): bool {
		if ( ( is_int( $a ) || is_float( $a ) ) && ( is_int( $b ) || is_float( $b ) ) ) {
			return (float) $a === (float) $b;
		}
		if ( is_array( $a ) && is_array( $b ) ) {
			return json_encode( $a ) === json_encode( $b );
		}
		return $a === $b;
	}

	/** @return array{path:string,message:string} */
	private static function issue( string $path, string $message ): array {
		return array(
			'path'    => $path,
			'message' => $message,
		);
	}
}
