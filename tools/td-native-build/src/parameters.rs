//! Extract declarative UI metadata without executing the sketch or its imports.
use anyhow::{Result, anyhow, bail};
use oxc_ast::ast::*;
use serde_json::{Map, Value};

pub fn extract(source: &str, path: &std::path::Path, exported: bool) -> Result<String> {
    if !exported {
        return Ok("{}".into());
    }
    let alloc = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(
        &alloc,
        source,
        oxc_span::SourceType::from_path(path).unwrap_or_default(),
    )
    .parse();
    for statement in &parsed.program.body {
        if let Statement::ExportDeclaration(export) = statement {
            if let Declaration::VariableDeclaration(decl) = &export.declaration {
                for var in &decl.declarations {
                    if let BindingPattern::BindingIdentifier(id) = &var.id {
                        if id.name == "parameters" {
                            let value = literal(
                                var.init
                                    .as_ref()
                                    .ok_or_else(|| anyhow!("parameters needs an initializer"))?,
                            )?;
                            if !value.is_object() {
                                bail!("parameters must be an object literal");
                            }
                            let json = serde_json::to_string(&value)?
                                .replace('\u{2028}', "\\u2028")
                                .replace('\u{2029}', "\\u2029");
                            if json.len() > 32768 {
                                bail!("parameters exceeds 32 KiB");
                            }
                            return Ok(json);
                        }
                    }
                }
            }
        }
    }
    bail!(
        "Declare parameters directly in the entry file: export const parameters = {{ ... }} as const. Imported, computed, and re-exported declarations are not supported."
    )
}
fn literal(expr: &Expression<'_>) -> Result<Value> {
    Ok(match expr.get_inner_expression() {
        Expression::ObjectExpression(obj) => {
            let mut result = Map::new();
            for prop in &obj.properties {
                let ObjectPropertyKind::ObjectProperty(prop) = prop else {
                    bail!("parameters cannot contain spreads");
                };
                if prop.computed || prop.method || prop.shorthand || prop.kind != PropertyKind::Init
                {
                    bail!("parameters must contain literal properties");
                }
                let key = prop
                    .key
                    .static_name()
                    .ok_or_else(|| anyhow!("parameters requires literal keys"))?;
                if result
                    .insert(key.to_string(), literal(&prop.value)?)
                    .is_some()
                {
                    bail!("Duplicate parameter property {key}");
                }
            }
            Value::Object(result)
        }
        Expression::ArrayExpression(array) => Value::Array(
            array
                .elements
                .iter()
                .map(|e| {
                    e.as_expression()
                        .ok_or_else(|| anyhow!("parameters arrays cannot contain spreads or holes"))
                        .and_then(literal)
                })
                .collect::<Result<_>>()?,
        ),
        Expression::StringLiteral(s) => Value::String(s.value.to_string()),
        Expression::BooleanLiteral(b) => Value::Bool(b.value),
        Expression::NumericLiteral(n) => {
            serde_json::Number::from_f64(n.value)
                .map(Value::Number)
                .ok_or_else(|| anyhow!("parameters numbers must be finite"))?
        }
        Expression::UnaryExpression(u) if u.operator.as_str() == "-" => {
            let n = literal(&u.argument)?
                .as_f64()
                .ok_or_else(|| anyhow!("parameters unary minus requires a number"))?;
            serde_json::Number::from_f64(-n)
                .map(Value::Number)
                .ok_or_else(|| anyhow!("parameters numbers must be finite"))?
        }
        _ => bail!(
            "parameters must be literal data (objects, arrays, strings, finite numbers, booleans); no function calls, references or computed values"
        ),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn literal_schema() {
        let json=extract("export const parameters = {Speed:{type:'float',default:-2}, Color:{type:'rgb',default:[1,0,0]}} as const satisfies Whatever;",std::path::Path::new("x.ts"),true).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&json).unwrap()["Speed"]["default"],
            -2.0
        );
        for source in [
            "export const parameters=make()",
            "export {parameters} from './x'",
            "export const parameters={...other}",
            "export const parameters={a:1,a:2}",
        ] {
            assert!(extract(source, std::path::Path::new("x.ts"), true).is_err());
        }
        assert_eq!(
            extract(
                "const parameters=anything()",
                std::path::Path::new("x.ts"),
                false
            )
            .unwrap(),
            "{}"
        );
    }
}
